import assert from 'node:assert/strict';

import { ExchangeStatus } from '../src/constants/exchange';
import type { Exchange } from '../src/models/exchange';
import type { Item } from '../src/models/item';
import type { PersistedEnvelope } from '../src/types';
import { runMigrations } from '../src/utils/migrations';
import { storage, STORAGE_KEYS } from '../src/utils/storage';

// 复用同一份内存桩（从测试文件导出不便，这里内联最小实现）。
const installMocks = () => {
  const local: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => local[k] ?? null,
    setItem: (k: string, v: string) => { local[k] = v; },
    removeItem: (k: string) => { delete local[k]; },
  };
  const data = new Map<string, unknown>();
  class FakeRequest<T = unknown> {
    result: T | undefined; error: Error | null = null; source = null;
    transaction: FakeTransaction | null = null;
    onsuccess: ((e: { target: FakeRequest<T> }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(private exec: () => T) { queueMicrotask(() => { this.result = exec(); this.onsuccess?.({ target: this }); }); }
    addEventListener() {}
  }
  class FakeTransaction {
    oncomplete: (() => void) | null = null; onabort = null; onerror = null; error = null;
    settle() { queueMicrotask(() => this.oncomplete?.()); }
    addEventListener() {}
  }
  const makeStore = (tx: FakeTransaction) => ({
    get: (key: string) => Object.assign(new FakeRequest(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)), { transaction: tx }),
    put: (value: unknown, key: string) => { data.set(key, structuredClone(value)); tx.settle(); return Object.assign(new FakeRequest(() => key), { transaction: tx }); },
    delete: (key: string) => { data.delete(key); tx.settle(); return Object.assign(new FakeRequest(() => undefined), { transaction: tx }); },
    transaction: tx,
  });
  const db = {
    objectStoreNames: { contains: (n: string) => n === 'keyval' },
    transaction() { const tx = new FakeTransaction(); return { objectStore: () => makeStore(tx) }; },
    close() {},
  };
  // indexedDB.open 的 request 会被 idb-keyval 反复重挂 onsuccess，做成可重复触发
  const listeners: Record<string, Array<(e?: unknown) => void>> = { success: [], upgradeneeded: [] };
  const openReq = {
    result: db,
    error: null,
    set onsuccess(fn: ((e?: unknown) => void) | null) { if (fn) listeners.success = [fn]; },
    get onsuccess() { return listeners.success[0] ?? null; },
    set onupgradeneeded(fn: ((e?: unknown) => void) | null) { if (fn) listeners.upgradeneeded = [fn]; },
    get onupgradeneeded() { return listeners.upgradeneeded[0] ?? null; },
    addEventListener(type: string, fn: (e?: unknown) => void) { (listeners[type] ??= []).push(fn); },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      queueMicrotask(() => listeners.success.forEach((fn) => fn({ target: openReq })));
      return openReq;
    },
  };
  return { local };
};

const main = async () => {
  const { local } = installMocks();

  // 直接构造 v1 信封（version=1）：2 个已完成 + 1 个待确认
  const v1 = 1;
  const items: Item[] = [
    { id: 'a1', user_id: 'u1', title: '物品甲', description: '', category: '数码', condition: 'good' as Item['condition'], images: [], status: 'exchanged' as Item['status'], location: '', created_at: '2026-09-01T00:00:00.000Z' },
    { id: 'b1', user_id: 'u2', title: '物品乙', description: '', category: '书籍', condition: 'good' as Item['condition'], images: [], status: 'exchanged' as Item['status'], location: '', created_at: '2026-09-02T00:00:00.000Z' },
    { id: 'c1', user_id: 'u1', title: '物品丙', description: '', category: '家居', condition: 'good' as Item['condition'], images: [], status: 'available' as Item['status'], location: '', created_at: '2026-09-03T00:00:00.000Z' },
  ];
  const users = [
    { id: 'u1', nickname: '甲', avatar: '', phone: '1', location: '', credit_score: 80, created_at: '' },
    { id: 'u2', nickname: '乙', avatar: '', phone: '2', location: '', credit_score: 81, created_at: '' },
  ];
  const exchanges: Exchange[] = [
    { id: 'ex1', from_user_id: 'u1', to_user_id: 'u2', from_item_id: 'a1', to_item_id: 'b1', status: ExchangeStatus.COMPLETED, message: '', created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:00:00.000Z' },
    { id: 'ex2', from_user_id: 'u2', to_user_id: 'u1', from_item_id: 'b1', to_item_id: 'c1', status: ExchangeStatus.PENDING, message: '', created_at: '2026-09-11T00:00:00.000Z', updated_at: '2026-09-11T00:00:00.000Z' },
  ];
  const wrap = <T>(payload: T): PersistedEnvelope<T> => ({ version: v1, expiresAt: Date.now() + 1e12, payload });
  local[STORAGE_KEYS.users] = JSON.stringify(wrap(users));
  local[STORAGE_KEYS.items] = JSON.stringify(wrap(items));
  local[STORAGE_KEYS.exchanges] = JSON.stringify(wrap(exchanges));

  const result = await runMigrations();
  assert.equal(result.upgraded, true);
  assert.equal(result.backfilled, 1, '只有 1 笔已完成交换需要回填');

  // 迁移后 storage 可读（信封升级到当前版本）
  const migratedExchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
  assert.equal(migratedExchanges.length, 2);

  const { settlementApi } = await import('../src/api/settlementApi');
  const receipts = await settlementApi.list();
  const receipt = receipts.find((r) => r.exchange_id === 'ex1')!;
  assert.ok(receipt, '已完成交换应有交割单');
  assert.equal(receipt.from_item.title, '物品甲');
  assert.equal(receipt.completed_at, '2026-09-10T00:00:00.000Z');
  assert.equal(receipts.filter((r) => r.exchange_id === 'ex2').length, 0, '待确认不回填');

  // 重跑迁移：幂等
  const again = await runMigrations();
  assert.equal(again.upgraded, false);
  const receipts2 = await settlementApi.list();
  assert.equal(receipts2.filter((r) => r.exchange_id === 'ex1').length, 1, '交割单不重复');

  console.log('migration checks passed');
};

main().catch((error) => { console.error(error); process.exit(1); });
