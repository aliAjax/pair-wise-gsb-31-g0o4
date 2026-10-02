import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 集成测试：走真实 storage + settlementApi 全链路。
 * 用内存 Map 模拟 localStorage 与 idb-keyval 后端。
 */

const idbStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => (idbStore.has(key) ? structuredClone(idbStore.get(key)) : undefined)),
  set: vi.fn(async (key: string, value: unknown) => {
    idbStore.set(key, structuredClone(value));
  }),
  del: vi.fn(async (key: string) => {
    idbStore.delete(key);
  }),
}));

class MemoryStorage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

vi.stubGlobal('localStorage', new MemoryStorage());

import { settlementApi } from '@/api/settlementApi';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const users = [
  { id: 'u1', nickname: '阿甲', avatar: '', phone: '1', location: '北京', credit_score: 90, created_at: 't0' },
  { id: 'u2', nickname: '阿乙', avatar: '', phone: '2', location: '上海', credit_score: 80, created_at: 't0' },
];

const writeBaseData = async (exchanges: Exchange[], items: Item[]) => {
  await storage.set(STORAGE_KEYS.users, users);
  await storage.set(STORAGE_KEYS.exchanges, exchanges);
  await storage.set(STORAGE_KEYS.items, items);
};

const item = (id: string, userId: string, title: string, status = ItemStatus.AVAILABLE): Item => ({
  id,
  user_id: userId,
  title,
  description: title,
  category: '家居',
  condition: 'good' as Item['condition'],
  images: [],
  status,
  location: '同城',
  created_at: 't0',
});

const exchange = (id: string, status: ExchangeStatus, updatedAt: string): Exchange => ({
  id,
  from_user_id: 'u1',
  to_user_id: 'u2',
  from_item_id: 'i1',
  to_item_id: 'i2',
  status,
  message: '成交留言',
  created_at: updatedAt,
  updated_at: updatedAt,
});

beforeEach(() => {
  localStorage.clear();
  idbStore.clear();
});

describe('settlementApi 存储链路', () => {
  it('旧版（v1）数据启动时按完成时间回填交割单，且不覆盖原数据', async () => {
    // 手工写入 v1 信封，模拟升级前的历史数据
    const v1Envelope = (payload: unknown) => ({ version: 1, expiresAt: Date.now() + 1e12, payload });
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(v1Envelope(users)));
    localStorage.setItem(
      STORAGE_KEYS.exchanges,
      JSON.stringify(v1Envelope([exchange('old1', ExchangeStatus.COMPLETED, '2026-07-01T00:00:00.000Z')])),
    );
    localStorage.setItem(
      STORAGE_KEYS.items,
      JSON.stringify(v1Envelope([item('i1', 'u1', '旧物品A'), item('i2', 'u2', '旧物品B')])),
    );

    await settlementApi.recover();

    const receipts = await settlementApi.list();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].backfilled).toBe(true);
    expect(receipts[0].from_item.title).toBe('旧物品A');
    expect(receipts[0].completed_at).toBe('2026-07-01T00:00:00.000Z');

    // 原交换数据仍在，且两侧物品被补齐为已交换
    const items = await storage.get<Item[]>(STORAGE_KEYS.items, []);
    expect(items.every((entry) => entry.status === ItemStatus.EXCHANGED)).toBe(true);
    const exchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    expect(exchanges[0].status).toBe(ExchangeStatus.COMPLETED);
  });

  it('成交后交割单写入 localStorage 与 IndexedDB，事后改名不影响', async () => {
    await writeBaseData(
      [exchange('ex1', ExchangeStatus.ACCEPTED, '2026-10-01T00:00:00.000Z')],
      [item('i1', 'u1', '露营椅'), item('i2', 'u2', '拍立得')],
    );

    const { receipt, recovered } = await settlementApi.settle('ex1');
    expect(recovered).toBe(false);
    expect(receipt.from_item.title).toBe('露营椅');

    // IndexedDB 里也有同一份交割单
    const idbRaw = idbStore.get(STORAGE_KEYS.receipts) as { payload: typeof receipt[] };
    expect(idbRaw.payload).toHaveLength(1);

    // 事后改名 + 下架
    const items = await storage.get<Item[]>(STORAGE_KEYS.items, []);
    await storage.set(
      STORAGE_KEYS.items,
      items.map((entry) => (entry.id === 'i1' ? { ...entry, title: '新名字', status: ItemStatus.OFFLINE } : entry)),
    );

    const stored = await settlementApi.getByExchange('ex1');
    expect(stored?.from_item.title).toBe('露营椅');
  });

  it('重复 settle 不会产生第二笔交割单，且补回一侧缺失的物品状态', async () => {
    await writeBaseData(
      [exchange('ex1', ExchangeStatus.ACCEPTED, '2026-10-01T00:00:00.000Z')],
      [item('i1', 'u1', '露营椅'), item('i2', 'u2', '拍立得')],
    );

    await settlementApi.settle('ex1');
    // 一侧物品被外部异常改回
    const tampered = (await storage.get<Item[]>(STORAGE_KEYS.items, [])).map((entry) =>
      entry.id === 'i1' ? { ...entry, status: ItemStatus.AVAILABLE } : entry,
    );
    await storage.set(STORAGE_KEYS.items, tampered);

    const { recovered } = await settlementApi.settle('ex1');
    expect(recovered).toBe(true);
    const receipts = await settlementApi.list();
    expect(receipts).toHaveLength(1);
    const items = await storage.get<Item[]>(STORAGE_KEYS.items, []);
    expect(items.map((entry) => entry.status)).toEqual([ItemStatus.EXCHANGED, ItemStatus.EXCHANGED]);
  });

  it('pending 残留时启动恢复能补完交割', async () => {
    await writeBaseData(
      [exchange('ex1', ExchangeStatus.ACCEPTED, '2026-10-01T00:00:00.000Z')],
      [item('i1', 'u1', '露营椅'), item('i2', 'u2', '拍立得')],
    );

    // 手工构造“物品与 pending 已写、交割单未写”的崩溃现场
    const exchangedItems = [
      { ...item('i1', 'u1', '露营椅'), status: ItemStatus.EXCHANGED },
      { ...item('i2', 'u2', '拍立得'), status: ItemStatus.EXCHANGED },
    ];
    await storage.set(STORAGE_KEYS.items, exchangedItems);
    await storage.set(STORAGE_KEYS.settlementPending, {
      exchange_id: 'ex1',
      receipt_id: 'receipt_ex1',
      completed_at: '2026-10-02T09:30:00.000Z',
      attempts: 1,
      created_at: '2026-10-02T09:30:00.000Z',
    });

    await settlementApi.recover();
    const receipts = await settlementApi.list();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].completed_at).toBe('2026-10-02T09:30:00.000Z');
    expect(await storage.get(STORAGE_KEYS.settlementPending, null)).toBeNull();
  });
});
