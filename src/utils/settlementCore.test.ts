import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type {
  PendingSettlement,
  SettlementGateway,
  SettlementReceipt,
} from '@/models/settlement';
import type { User } from '@/models/user';
import {
  backfillReceipts,
  buildReceipt,
  commitSettlement,
  recoverSettlements,
} from '@/utils/settlementCore';

const users: User[] = [
  { id: 'u1', nickname: '阿甲', avatar: '', phone: '1', location: '北京', credit_score: 90, created_at: 't0' },
  { id: 'u2', nickname: '阿乙', avatar: '', phone: '2', location: '上海', credit_score: 80, created_at: 't0' },
];

const makeItem = (id: string, userId: string, title: string, status = ItemStatus.AVAILABLE): Item => ({
  id,
  user_id: userId,
  title,
  description: `${title}描述`,
  category: '数码',
  condition: ItemCondition.GOOD,
  images: [],
  status,
  location: '同城',
  created_at: 't0',
});

const makeExchange = (id: string, status: ExchangeStatus, updatedAt: string): Exchange => ({
  id,
  from_user_id: 'u1',
  to_user_id: 'u2',
  from_item_id: 'i1',
  to_item_id: 'i2',
  status,
  message: '换一下',
  created_at: updatedAt,
  updated_at: updatedAt,
});

interface MemoryState {
  receipts: SettlementReceipt[];
  pending: PendingSettlement | null;
  exchanges: Exchange[];
  items: Item[];
  users: User[];
}

/** 内存网关 + 可注入的写入故障，用于模拟“写到一半失败” */
const createMemoryGateway = (state: MemoryState) => {
  const failures = {
    writeItems: vi.fn<() => boolean>(),
    writeExchanges: vi.fn<() => boolean>(),
    writeReceipts: vi.fn<() => boolean>(),
    setPending: vi.fn<() => boolean>(),
  };

  const maybeFail = (fn: () => boolean, label: string) => {
    if (fn()) throw new Error(`simulated ${label} failure`);
  };

  const gateway: SettlementGateway = {
    listReceipts: vi.fn(async () => state.receipts),
    writeReceipts: vi.fn(async (receipts) => {
      maybeFail(failures.writeReceipts, 'writeReceipts');
      state.receipts = JSON.parse(JSON.stringify(receipts));
    }),
    getPending: vi.fn(async () => state.pending),
    setPending: vi.fn(async (pending) => {
      maybeFail(failures.setPending, 'setPending');
      state.pending = pending ? JSON.parse(JSON.stringify(pending)) : null;
    }),
    listExchanges: vi.fn(async () => state.exchanges),
    writeExchanges: vi.fn(async (exchanges) => {
      maybeFail(failures.writeExchanges, 'writeExchanges');
      state.exchanges = JSON.parse(JSON.stringify(exchanges));
    }),
    listItems: vi.fn(async () => state.items),
    writeItems: vi.fn(async (items) => {
      maybeFail(failures.writeItems, 'writeItems');
      state.items = JSON.parse(JSON.stringify(items));
    }),
    listUsers: vi.fn(async () => state.users),
  };

  return { gateway, state, failures };
};

type Harness = ReturnType<typeof createMemoryGateway>;

const freshState = (exchangeStatus = ExchangeStatus.ACCEPTED): MemoryState => ({
  receipts: [],
  pending: null,
  exchanges: [makeExchange('ex1', exchangeStatus, '2026-09-01T10:00:00.000Z')],
  items: [makeItem('i1', 'u1', '露营椅'), makeItem('i2', 'u2', '拍立得')],
  users: [...users],
});

describe('commitSettlement 正常成交', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createMemoryGateway(freshState());
  });

  it('生成不可改交割单，保存双方物品与资料快照', async () => {
    const { receipt } = await commitSettlement(harness.gateway, 'ex1');
    expect(receipt.id).toBe('receipt_ex1');
    expect(receipt.from_item.title).toBe('露营椅');
    expect(receipt.to_item.title).toBe('拍立得');
    expect(receipt.from_user.nickname).toBe('阿甲');
    expect(receipt.to_user.nickname).toBe('阿乙');
    expect(receipt.backfilled).toBe(false);
    expect(receipt.seq).toBe(1);
  });

  it('两个物品状态在同一次整表写回中一起变为已交换，不会只改一侧', async () => {
    await commitSettlement(harness.gateway, 'ex1');
    const statuses = harness.state.items.map((item) => item.status);
    expect(statuses).toEqual([ItemStatus.EXCHANGED, ItemStatus.EXCHANGED]);
    // writeItems 只被调用一次：两侧状态绑定在同一张表上
    expect(harness.gateway.writeItems).toHaveBeenCalledTimes(1);
  });

  it('完成后清除 pending 标记', async () => {
    await commitSettlement(harness.gateway, 'ex1');
    expect(harness.state.pending).toBeNull();
  });

  it('非“已同意”状态不能成交', async () => {
    const rejected = createMemoryGateway(freshState(ExchangeStatus.PENDING));
    await expect(commitSettlement(rejected.gateway, 'ex1')).rejects.toThrow('当前状态');
    expect(rejected.state.receipts).toHaveLength(0);
  });
});

describe('物品事后改名或下架不影响交割单', () => {
  it('交割单显示成交时标题，与实时物品脱钩', async () => {
    const harness = createMemoryGateway(freshState());
    const { receipt } = await commitSettlement(harness.gateway, 'ex1');

    // 事后：物品改名 + 下架
    harness.state.items = harness.state.items.map((item) =>
      item.id === 'i2' ? { ...item, title: '已改名的新标题', status: ItemStatus.OFFLINE } : item,
    );

    const rebuilt = buildReceipt(
      harness.state.exchanges[0],
      harness.state.items,
      harness.state.users,
      new Date().toISOString(),
    );
    // 新构造的快照会反映现实，但已落盘的旧交割单内容不变
    expect(rebuilt.to_item.title).toBe('已改名的新标题');
    expect(receipt.to_item.title).toBe('拍立得');
    expect(receipt.to_item.status).toBe(ItemStatus.EXCHANGED);
  });
});

describe('写入失败后的恢复', () => {
  it('在写物品后、写交割单前崩溃：重试恢复且只产生一笔交割单', async () => {
    const harness = createMemoryGateway(freshState());
    let call = 0;
    harness.failures.writeExchanges.mockImplementation(() => {
      call += 1;
      return call === 1; // 第一次写交换状态时失败
    });

    await expect(commitSettlement(harness.gateway, 'ex1')).rejects.toThrow('simulated');
    // 物品两侧已经一起落盘
    expect(harness.state.items.every((item) => item.status === ItemStatus.EXCHANGED)).toBe(true);
    // 交换仍停留在已同意、pending 还在
    expect(harness.state.exchanges[0].status).toBe(ExchangeStatus.ACCEPTED);
    expect(harness.state.pending).not.toBeNull();

    // 重新进入应用后走恢复流程
    const report = await recoverSettlements(harness.gateway);
    expect(harness.state.receipts).toHaveLength(1);
    expect(harness.state.receipts[0].id).toBe('receipt_ex1');
    expect(harness.state.exchanges[0].status).toBe(ExchangeStatus.COMPLETED);
    expect(harness.state.pending).toBeNull();
    expect(report.droppedPending).toEqual([]);
  });

  it('交割单已写入但清 pending 前崩溃：恢复时复用同一 completed_at，不重复生成', async () => {
    const harness = createMemoryGateway(freshState());
    let call = 0;
    // writeReceipts 成功后的 setPending(null) 第一次失败
    harness.failures.setPending.mockImplementation(() => {
      call += 1;
      // 第 1 次是写 pending（成功），第 2 次是清除（失败）
      return call === 2;
    });

    await expect(commitSettlement(harness.gateway, 'ex1')).rejects.toThrow('simulated');
    expect(harness.state.receipts).toHaveLength(1);
    const firstCompletedAt = harness.state.receipts[0].completed_at;
    expect(harness.state.pending).not.toBeNull();

    await recoverSettlements(harness.gateway);
    expect(harness.state.receipts).toHaveLength(1);
    expect(harness.state.receipts[0].completed_at).toBe(firstCompletedAt);
    expect(harness.state.pending).toBeNull();
  });

  it('交割单已存在时直接重试：补回缺失的一侧物品状态，不重复生成记录', async () => {
    const harness = createMemoryGateway(freshState());
    await commitSettlement(harness.gateway, 'ex1');

    // 事后一侧物品状态被外部异常改回可交换（模拟“只改了一侧”的脏数据）
    harness.state.items = harness.state.items.map((item) =>
      item.id === 'i1' ? { ...item, status: ItemStatus.AVAILABLE } : item,
    );

    const { receipt, recovered } = await commitSettlement(harness.gateway, 'ex1');
    expect(recovered).toBe(true);
    expect(harness.state.receipts).toHaveLength(1);
    expect(receipt.id).toBe('receipt_ex1');
    // 两侧都被补齐
    expect(harness.state.items.map((item) => [item.id, item.status])).toEqual([
      ['i1', ItemStatus.EXCHANGED],
      ['i2', ItemStatus.EXCHANGED],
    ]);
  });
});

describe('旧数据升级按完成时间回填', () => {
  it('为历史已完成交换回填交割单、修复物品状态，已存在的交割单保持不变', async () => {
    const state: MemoryState = {
      receipts: [],
      pending: null,
      exchanges: [
        makeExchange('old1', ExchangeStatus.COMPLETED, '2026-08-01T08:00:00.000Z'),
        makeExchange('old2', ExchangeStatus.COMPLETED, '2026-09-01T08:00:00.000Z'),
        { ...makeExchange('pending1', ExchangeStatus.PENDING, '2026-09-02T08:00:00.000Z'), from_item_id: 'i3', to_item_id: 'i4' },
      ],
      items: [
        // old1 一侧物品漏改（旧 bug：只改一侧），old2 两侧已改
        makeItem('i1', 'u1', '露营椅', ItemStatus.AVAILABLE),
        makeItem('i2', 'u2', '拍立得', ItemStatus.EXCHANGED),
        makeItem('i3', 'u1', '耳机', ItemStatus.AVAILABLE),
        makeItem('i4', 'u2', '键盘', ItemStatus.AVAILABLE),
      ],
      users: [...users],
    };
    const harness = createMemoryGateway(state);

    const { receipts, report } = await backfillReceipts(harness.gateway);
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.exchange_id)).toEqual(['old1', 'old2']);
    expect(receipts.map((receipt) => receipt.seq)).toEqual([1, 2]);
    expect(receipts.every((receipt) => receipt.backfilled)).toBe(true);
    expect(report.recovered).toEqual(['old1', 'old2']);
    // 漏改的一侧被补齐，未成交物品不动
    const statusMap = new Map(harness.state.items.map((item) => [item.id, item.status]));
    expect(statusMap.get('i1')).toBe(ItemStatus.EXCHANGED);
    expect(statusMap.get('i2')).toBe(ItemStatus.EXCHANGED);
    expect(statusMap.get('i3')).toBe(ItemStatus.AVAILABLE);
    expect(statusMap.get('i4')).toBe(ItemStatus.AVAILABLE);

    // 再跑一次：幂等，不重复回填，不改变已有交割单
    const second = await backfillReceipts(harness.gateway);
    expect(second.receipts).toHaveLength(2);
    expect(second.report.recovered).toEqual([]);
  });

  it('回填时物品已找不到，生成兜底快照并标记 missing', async () => {
    const state: MemoryState = {
      receipts: [],
      pending: null,
      exchanges: [makeExchange('old1', ExchangeStatus.COMPLETED, '2026-08-01T08:00:00.000Z')],
      items: [], // 物品已被清理
      users: [],
    };
    const harness = createMemoryGateway(state);
    const { receipts } = await backfillReceipts(harness.gateway);
    expect(receipts[0].from_item.missing_at_settlement).toBe(true);
    expect(receipts[0].to_user.missing_at_settlement).toBe(true);
  });
});
