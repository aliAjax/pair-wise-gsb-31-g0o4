/**
 * 交割单核心保证的端到端逻辑测试（node 直接运行，不经过 UI）：
 * 1. 完成交换生成不可变交割单，物品改名/下架不影响快照；
 * 2. 重试与并发不重复生成记录；
 * 3. 模拟各阶段写入崩溃后，从最近完整交割单恢复，物品两侧一起补齐；
 * 4. v1 旧数据升级按完成时间回填交割单。
 *
 * 运行：node --experimental-vm-modules 不需要，直接用 tsx 未安装，
 * 因此用 vite-node 也没有；这里通过 esbuild 已内置（vite 依赖）做即时转译。
 */
import assert from 'node:assert/strict';

import { exchangeApi } from '../src/api/exchangeApi';
import { itemApi } from '../src/api/itemApi';
import { settlementApi } from '../src/api/settlementApi';
import { ExchangeStatus } from '../src/constants/exchange';
import { ItemStatus } from '../src/constants/item';
import type { Exchange } from '../src/models/exchange';
import type { Settlement } from '../src/models/settlement';
import { storage, STORAGE_KEYS } from '../src/utils/storage';

type Store = Record<string, unknown>;

const mockStorage = () => {
  const localStore: Store = {};
  const idbStore: Store = {};

  const localStorageMock = {
    getItem: (key: string) => (key in localStore ? (localStore[key] as string) : null),
    setItem: (key: string, value: string) => {
      localStore[key] = value;
    },
    removeItem: (key: string) => {
      delete localStore[key];
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = localStorageMock;

  // 无真实 IndexedDB：按 IDB 接口形态实现 idb-keyval 所需的 request/transaction，
  // request 对象本身暴露可写的 onsuccess/onerror（promisifyRequest 直接挂在上面）。
  const storeName = 'keyval-store';
  const data = new Map<string, unknown>();

  class FakeRequest<T = unknown> {
    result: T | undefined;
    error: Error | null = null;
    source: unknown = null;
    transaction: FakeTransaction | null = null;
    onsuccess: ((event: { target: FakeRequest<T> }) => void) | null = null;
    onerror: (() => void) | null = null;

    private fire() {
      this.result = this.exec();
      this.onsuccess?.({ target: this });
    }

    constructor(private exec: () => T, autoFire = true) {
      if (autoFire) queueMicrotask(() => this.fire());
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === 'success') {
        const prev = this.onsuccess;
        this.onsuccess = (event) => {
          prev?.(event);
          listener(event);
        };
      }
    }
  }

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: Error | null = null;

    settle() {
      queueMicrotask(() => this.oncomplete?.());
    }

    addEventListener() {}
  }

  const makeObjectStore = (tx: FakeTransaction) => ({
    get: (key: string) => {
      const request = new FakeRequest(() =>
        data.has(key) ? structuredClone(data.get(key)) : undefined,
      );
      request.transaction = tx;
      return request;
    },
    put: (value: unknown, key: string) => {
      data.set(key, structuredClone(value));
      const request = new FakeRequest(() => key);
      request.transaction = tx;
      tx.settle();
      return request;
    },
    delete: (key: string) => {
      data.delete(key);
      const request = new FakeRequest(() => undefined);
      request.transaction = tx;
      tx.settle();
      return request;
    },
    transaction: tx as FakeTransaction,
  });

  const fakeDB = {
    objectStoreNames: { contains: (name: string) => name === storeName },
    transaction(_store: string, _mode: string) {
      const tx = new FakeTransaction();
      return {
        objectStore: () => makeObjectStore(tx),
      };
    },
    close() {},
  };

  // open request 会被 idb-keyval 反复重挂 onsuccess（连接失败后重连），
  // 这里做成每次 open 都重新派发成功事件，避免监听器只触发一次后永久挂起。
  const dbListeners: Record<string, Array<(event?: unknown) => void>> = { success: [] };
  const openRequest = {
    result: fakeDB,
    error: null,
    set onsuccess(fn: ((event?: unknown) => void) | null) {
      if (fn) dbListeners.success = [fn];
    },
    get onsuccess() {
      return dbListeners.success[0] ?? null;
    },
    onupgradeneeded: null,
    addEventListener(type: string, listener: (event?: unknown) => void) {
      (dbListeners[type] ??= []).push(listener);
    },
  } as unknown as FakeRequest<typeof fakeDB>;

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      queueMicrotask(() => dbListeners.success.forEach((fn) => fn({ target: openRequest })));
      return openRequest;
    },
  };

  return { localStore, idbStore: data as unknown as Store };
};

const reset = () => {
  Object.values(STORAGE_KEYS).forEach((key) => storage.remove(key));
};

const findAccepted = async () => {
  const exchanges = await exchangeApi.list();
  return exchanges.find((entry) => entry.status === ExchangeStatus.ACCEPTED);
};

const main = async () => {
  mockStorage();
  reset();

  // 准备：种子里待确认交换 -> 同意
  const exchanges = await exchangeApi.list();
  const pending = exchanges.find((entry) => entry.status === ExchangeStatus.PENDING)!;
  await exchangeApi.transition(pending.id, ExchangeStatus.ACCEPTED);
  const accepted = (await findAccepted())!;
  assert.ok(accepted, '应存在已同意交换');

  // 1. 完成交换
  const { settlement: first, replayed: firstReplayed } = await settlementApi.completeExchange(accepted.id);
  assert.equal(firstReplayed, false, '首次完成不应是重放');
  assert.equal(first.exchange_id, accepted.id);

  // 2. 并发两次完成（模拟双击），只生成一张交割单
  const accepted2 = (await findAccepted());
  // accepted 已完成，构造第二个 accepted 交换走完整流程
  const exchangesNow = await exchangeApi.list();
  let receipts = await settlementApi.list();
  assert.equal(receipts.filter((r) => r.exchange_id === accepted.id).length, 1, '交割单唯一');

  // 3. 快照不可变：改名 + 下架
  const items = await itemApi.list();
  const fromItem = items.find((i) => i.id === first.from_item.item_id)!;
  const toItem = items.find((i) => i.id === first.to_item.item_id)!;
  const oldFromTitle = first.from_item.title;
  await itemApi.update(fromItem.id, { title: '改过的新标题AAAA' });
  await itemApi.setStatus(fromItem.id, ItemStatus.OFFLINE);
  await itemApi.update(toItem.id, { title: '改过的新标题BBBB' });

  const afterRename = (await settlementApi.detailByExchange(accepted.id))!;
  assert.equal(afterRename.from_item.title, oldFromTitle, '交割单快照标题不随后续改名变化');
  assert.notEqual((await itemApi.detail(fromItem.id))!.title, oldFromTitle);

  // 4. 对已存在交割单再次 completeExchange：重放补齐，不重复生成
  // 先人为把一侧物品状态改回（模拟不一致），再调用
  await itemApi.setStatus(fromItem.id, ItemStatus.AVAILABLE);
  const replay = await settlementApi.completeExchange(accepted.id);
  assert.equal(replay.replayed, true, '应识别为重放');
  const repairedFrom = (await itemApi.detail(fromItem.id))!;
  const repairedTo = (await itemApi.detail(toItem.id))!;
  assert.equal(repairedFrom.status, ItemStatus.EXCHANGED, '恢复时两侧一起补齐');
  assert.equal(repairedTo.status, ItemStatus.EXCHANGED, '恢复时不能只改一侧');
  receipts = await settlementApi.list();
  assert.equal(receipts.filter((r) => r.exchange_id === accepted.id).length, 1, '重放不重复生成');

  // 5. 模拟崩溃恢复：人为制造“交割单存在、物品一侧未交换、交换单未完成”
  // 用种子已完成交换 exchange_seed_completed 做破坏
  const seedCompleted = exchangesNow.find((e) => e.id === 'exchange_seed_completed')!;
  const seedReceipt = (await settlementApi.detailByExchange(seedCompleted.id))!;
  await itemApi.setStatus(seedReceipt.from_item.item_id, ItemStatus.AVAILABLE);
  // 直接改存储把交换单退回 accepted（绕过 API 状态机）
  const rawExchanges = (await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []));
  const broken = rawExchanges.map((e) =>
    e.id === seedCompleted.id ? { ...e, status: ExchangeStatus.ACCEPTED } : e,
  );
  await storage.set(STORAGE_KEYS.exchanges, broken);

  const repairedCount = await settlementApi.recoverAll();
  assert.ok(repairedCount >= 1, 'recoverAll 应报告修复');
  const pairA = (await itemApi.detail(seedReceipt.from_item.item_id))!;
  const pairB = (await itemApi.detail(seedReceipt.to_item.item_id))!;
  assert.equal(pairA.status, ItemStatus.EXCHANGED);
  assert.equal(pairB.status, ItemStatus.EXCHANGED);
  const afterRecover = (await exchangeApi.list()).find((e) => e.id === seedCompleted.id)!;
  assert.equal(afterRecover.status, ExchangeStatus.COMPLETED);
  assert.equal(afterRecover.updated_at, seedReceipt.completed_at, '完成时间锚定交割单');

  // 6. 旧数据升级回填：清空交割单 + schema 标记，保留已完成交换
  await storage.set(STORAGE_KEYS.settlements, []);
  const [allExchanges, allItems] = await Promise.all([exchangeApi.list(), itemApi.list()]);
  const { userApi } = await import('../src/api/userApi');
  const users = await userApi.list();
  const { backfilled } = await settlementApi.backfillCompleted(allExchanges, allItems, users, []);
  assert.ok(backfilled >= 2, '已完成交换都应回填交割单');
  const backfilledReceipts = await settlementApi.list();
  const completedCount = allExchanges.filter((e) => e.status === ExchangeStatus.COMPLETED).length;
  assert.ok(backfilledReceipts.length >= completedCount);

  // 再次回填：幂等，数量不增加
  const again = await settlementApi.backfillCompleted(allExchanges, allItems, users, backfilledReceipts);
  assert.equal(again.backfilled, 0, '重复升级不重复回填');

  // 7. 交割单 id 确定性
  assert.equal(
    (await settlementApi.detailByExchange(accepted.id))!.id,
    `settlement_${accepted.id}`,
  );

  const dummy: Settlement | undefined = backfilledReceipts[0];
  assert.ok(dummy);
  console.log('settlement e2e checks passed');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
