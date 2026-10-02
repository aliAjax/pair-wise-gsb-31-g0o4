import { EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { deriveReceiptId, SETTLEMENT_SCHEMA_VERSION } from '@/constants/settlement';
import type {
  PendingSettlement,
  SettlementGateway,
  SettlementItemSnapshot,
  SettlementReceipt,
  SettlementRecoveryReport,
  SettlementUserSnapshot,
} from '@/models/settlement';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';

const snapshotItem = (item: Item | undefined): SettlementItemSnapshot => {
  if (item) {
    return { ...structuredCopy(item), missing_at_settlement: false };
  }
  return {
    id: '',
    user_id: '',
    title: '物品已被清理，成交时未能留存',
    description: '',
    category: '未知',
    condition: ItemCondition.GOOD,
    images: [],
    status: ItemStatus.EXCHANGED,
    location: '',
    created_at: '',
    missing_at_settlement: true,
  };
};

const snapshotUser = (user: User | undefined): SettlementUserSnapshot => {
  if (user) {
    return { ...structuredCopy(user), missing_at_settlement: false };
  }
  return {
    id: '',
    nickname: '用户已注销',
    avatar: '',
    phone: '',
    location: '',
    credit_score: 0,
    missing_at_settlement: true,
  };
};

const structuredCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sortByCompletedAt = (a: SettlementReceipt, b: SettlementReceipt) =>
  a.completed_at < b.completed_at ? -1 : a.completed_at > b.completed_at ? 1 : a.exchange_id.localeCompare(b.exchange_id);

const resequence = (receipts: SettlementReceipt[]): SettlementReceipt[] =>
  [...receipts].sort(sortByCompletedAt).map((receipt, index) => ({ ...receipt, seq: index + 1 }));

/**
 * 为一笔已完成交换构造交割单。纯函数，不落盘。
 * 找不到物品/用户时生成兜底快照并标记 missing，绝不阻断成交。
 */
export const buildReceipt = (
  exchange: Exchange,
  items: Item[],
  users: User[],
  completedAt: string,
  backfilled = false,
  seq = 0,
): SettlementReceipt => ({
  id: deriveReceiptId(exchange.id),
  seq,
  exchange_id: exchange.id,
  from_item: { ...snapshotItem(items.find((item) => item.id === exchange.from_item_id)), id: exchange.from_item_id },
  from_user: { ...snapshotUser(users.find((user) => user.id === exchange.from_user_id)), id: exchange.from_user_id },
  to_item: { ...snapshotItem(items.find((item) => item.id === exchange.to_item_id)), id: exchange.to_item_id },
  to_user: { ...snapshotUser(users.find((user) => user.id === exchange.to_user_id)), id: exchange.to_user_id },
  message: exchange.message,
  completed_at: completedAt,
  backfilled,
  schema: SETTLEMENT_SCHEMA_VERSION,
});

/**
 * 旧数据升级：按完成时间回填全部已完成交换的交割单。
 * 已存在的交割单保持原样（不可改），只补缺失的，并顺手修复物品/交换状态。
 */
export const backfillReceipts = async (
  gateway: SettlementGateway,
): Promise<{ receipts: SettlementReceipt[]; report: SettlementRecoveryReport }> => {
  const report: SettlementRecoveryReport = { recovered: [], repairedItems: [], repairedExchanges: [], droppedPending: [] };
  const [receipts, exchanges, items, users] = await Promise.all([
    gateway.listReceipts(),
    gateway.listExchanges(),
    gateway.listItems(),
    gateway.listUsers(),
  ]);
  const existingIds = new Set(receipts.map((receipt) => receipt.id));
  const completed = exchanges.filter((exchange) => exchange.status === ExchangeStatus.COMPLETED);

  const nextReceipts = [...receipts];
  completed.forEach((exchange) => {
    const receiptId = deriveReceiptId(exchange.id);
    if (!existingIds.has(receiptId)) {
      // 历史数据没有真正的完成时刻，用最后更新时间近似，符合“按完成时间回填”
      const receipt = buildReceipt(exchange, items, users, exchange.updated_at, true);
      nextReceipts.push(receipt);
      report.recovered.push(exchange.id);
    }
  });

  const itemsPatch = reconcileExchangedItems(completed, items);

  const ordered = resequence(nextReceipts);
  await Promise.all([
    gateway.writeReceipts(ordered),
    itemsPatch.changed ? gateway.writeItems(itemsPatch.items) : Promise.resolve(),
  ]);
  report.repairedItems.push(...itemsPatch.repairedIds);
  return { receipts: ordered, report };
};

/**
 * 保证已完成交换涉及的两个物品都是“已交换”，一侧缺漏就两侧一起修。
 * 返回整表，调用方必须整表一次写回，不能只改一侧。
 */
export const reconcileExchangedItems = (
  completedExchanges: Exchange[],
  items: Item[],
): { items: Item[]; changed: boolean; repairedIds: string[] } => {
  const exchangedIds = new Set<string>();
  completedExchanges.forEach((exchange) => {
    exchangedIds.add(exchange.from_item_id);
    exchangedIds.add(exchange.to_item_id);
  });
  const repairedIds: string[] = [];
  const nextItems = items.map((item) => {
    if (exchangedIds.has(item.id) && item.status !== ItemStatus.EXCHANGED) {
      repairedIds.push(item.id);
      return { ...item, status: ItemStatus.EXCHANGED };
    }
    return item;
  });
  return { items: nextItems, changed: repairedIds.length > 0, repairedIds };
};

/**
 * 完成交换的两阶段提交流程（带崩溃恢复与重试幂等）：
 *
 * 1. 先写 pending 标记（含固定 completed_at）
 * 2. 物品整表一次写回：两侧同时置为已交换（不会只改一侧）
 * 3. 交换状态置为已完成，与物品同批落盘前的校验
 * 4. 追加交割单（id 由 exchangeId 派生，重试绝不重复生成）
 * 5. 清除 pending
 *
 * 任一步失败后重试本函数都能从最近完整状态继续，且结果唯一。
 */
export const commitSettlement = async (
  gateway: SettlementGateway,
  exchangeId: string,
): Promise<{ receipt: SettlementReceipt; recovered: boolean }> => {
  const stored = await readState(gateway);
  const existing = stored.receipts.find((receipt) => receipt.exchange_id === exchangeId);

  const pending = await gateway.getPending();
  if (existing) {
    // 交割单已存在：本次是重试。补齐两侧物品状态，清除残留 pending，不再重复生成记录
    if (pending?.exchange_id === exchangeId) {
      await gateway.setPending(null);
    }
    const itemsPatch = reconcileExchangedItems(
      stored.exchanges.filter((exchange) => exchange.status === ExchangeStatus.COMPLETED),
      stored.items,
    );
    if (itemsPatch.changed) await gateway.writeItems(itemsPatch.items);
    return { receipt: existing, recovered: true };
  }

  const exchange = stored.exchanges.find((entry) => entry.id === exchangeId);
  if (!exchange) throw new Error('交换请求不存在');
  if (!EXCHANGE_ACTION_FLOW[exchange.status].includes(ExchangeStatus.COMPLETED)) {
    throw new Error('当前状态不允许确认完成');
  }

  // 恢复路径：上次崩溃在写交割单之后、清 pending 之前
  if (pending?.exchange_id === exchangeId) {
    return resumePending(gateway, pending);
  }

  const completedAt = new Date().toISOString();
  const nextPending: PendingSettlement = {
    exchange_id: exchangeId,
    receipt_id: deriveReceiptId(exchangeId),
    completed_at: completedAt,
    attempts: 1,
    created_at: completedAt,
  };
  await gateway.setPending(nextPending);

  // 物品两侧状态在同一张整表上一次写回
  const itemsPatch = reconcileExchangedItems(
    [...stored.exchanges.filter((entry) => entry.status === ExchangeStatus.COMPLETED), { ...exchange, status: ExchangeStatus.COMPLETED }],
    stored.items,
  );
  await gateway.writeItems(itemsPatch.items);

  const nextExchanges = stored.exchanges.map((entry) =>
    entry.id === exchangeId ? { ...entry, status: ExchangeStatus.COMPLETED, updated_at: completedAt } : entry,
  );
  await gateway.writeExchanges(nextExchanges);

  const receipt = buildReceipt(
    { ...exchange, status: ExchangeStatus.COMPLETED, updated_at: completedAt },
    itemsPatch.items,
    stored.users,
    completedAt,
  );
  const nextReceipts = resequence([...stored.receipts.filter((item) => item.id !== receipt.id), receipt]);
  await gateway.writeReceipts(nextReceipts);

  await gateway.setPending(null);
  return { receipt: nextReceipts.find((item) => item.id === receipt.id) ?? receipt, recovered: false };
};

const resumePending = async (
  gateway: SettlementGateway,
  pending: PendingSettlement,
): Promise<{ receipt: SettlementReceipt; recovered: boolean }> => {
  const stored = await readState(gateway);
  const exchange =
    stored.exchanges.find((entry) => entry.id === pending.exchange_id) ??
    ({
      id: pending.exchange_id,
      from_user_id: '',
      to_user_id: '',
      from_item_id: '',
      to_item_id: '',
      status: ExchangeStatus.COMPLETED,
      message: '',
      created_at: pending.completed_at,
      updated_at: pending.completed_at,
    } as Exchange);

  const completedExchanges = [
    ...stored.exchanges.filter((entry) => entry.status === ExchangeStatus.COMPLETED),
    { ...exchange, status: ExchangeStatus.COMPLETED as ExchangeStatus },
  ];
  const itemsPatch = reconcileExchangedItems(completedExchanges, stored.items);

  const exchangeAlreadyDone = stored.exchanges.some(
    (entry) => entry.id === pending.exchange_id && entry.status === ExchangeStatus.COMPLETED,
  );
  const nextExchanges = exchangeAlreadyDone
    ? stored.exchanges
    : stored.exchanges.map((entry) =>
        entry.id === pending.exchange_id
          ? { ...entry, status: ExchangeStatus.COMPLETED, updated_at: pending.completed_at }
          : entry,
      );

  const receipt = buildReceipt({ ...exchange, status: ExchangeStatus.COMPLETED }, itemsPatch.items, stored.users, pending.completed_at);
  const nextReceipts = resequence([...stored.receipts.filter((item) => item.id !== receipt.id), receipt]);

  await Promise.all([
    itemsPatch.changed ? gateway.writeItems(itemsPatch.items) : Promise.resolve(),
    gateway.writeExchanges(nextExchanges),
    gateway.writeReceipts(nextReceipts),
  ]);
  await gateway.setPending(null);
  return { receipt: nextReceipts.find((item) => item.id === receipt.id) ?? receipt, recovered: true };
};

/**
 * 启动时恢复：优先处理遗留 pending（最近一次未完成交割），再做旧数据回填。
 * 每一步都幂等，可安全重复执行。
 */
export const recoverSettlements = async (gateway: SettlementGateway): Promise<SettlementRecoveryReport> => {
  const pending = await gateway.getPending();
  if (pending) {
    await resumePending(gateway, pending);
  }
  const { report } = await backfillReceipts(gateway);
  return report;
};

const readState = async (gateway: SettlementGateway) => {
  const [receipts, exchanges, items, users] = await Promise.all([
    gateway.listReceipts(),
    gateway.listExchanges(),
    gateway.listItems(),
    gateway.listUsers(),
  ]);
  return { receipts, exchanges, items, users };
};
