import type { ItemCondition, ItemStatus } from '@/constants/item';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';

/**
 * 交割单中一方物品在成交瞬间的快照。
 * 物品之后改名、下架都不影响这里的内容。
 */
export interface SettlementItemSnapshot {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  images: string[];
  status: ItemStatus;
  location: string;
  created_at: string;
  /** 成交时找不到物品（已被清理）时为 true，快照内容为回填兜底值 */
  missing_at_settlement: boolean;
}

/** 交割单中一方用户资料在成交瞬间的快照。 */
export interface SettlementUserSnapshot {
  id: string;
  nickname: string;
  avatar: string;
  phone: string;
  location: string;
  credit_score: number;
  missing_at_settlement: boolean;
}

/**
 * 交割单（不可改）。
 * 一旦写入，应用层不提供任何更新/删除入口，后续展示一律以此为准。
 */
export interface SettlementReceipt {
  /** 固定派生 id：`receipt_${exchangeId}`，用于重试去重 */
  id: string;
  /** 交割流水号，按完成时间回填排序后生成 */
  seq: number;
  exchange_id: string;
  /** 发起方拿出的物品与资料快照 */
  from_item: SettlementItemSnapshot;
  from_user: SettlementUserSnapshot;
  /** 接收方拿出的物品与资料快照 */
  to_item: SettlementItemSnapshot;
  to_user: SettlementUserSnapshot;
  message: string;
  completed_at: string;
  /** 升级回填的历史数据标记为 true */
  backfilled: boolean;
  schema: 1;
}

/** 提交交割单过程中的未落盘标记，用于崩溃恢复。 */
export interface PendingSettlement {
  exchange_id: string;
  receipt_id: string;
  /** 目标完成时间，与交割单一致，保证重试不漂移 */
  completed_at: string;
  attempts: number;
  created_at: string;
}

/** 交割数据网关，便于单测注入故障与内存存储。 */
export interface SettlementGateway {
  listReceipts(): Promise<SettlementReceipt[]>;
  writeReceipts(receipts: SettlementReceipt[]): Promise<void>;
  getPending(): Promise<PendingSettlement | null>;
  setPending(pending: PendingSettlement | null): Promise<void>;
  listExchanges(): Promise<Exchange[]>;
  writeExchanges(exchanges: Exchange[]): Promise<void>;
  listItems(): Promise<Item[]>;
  /** 物品必须整表一次写回，两侧状态同生共死 */
  writeItems(items: Item[]): Promise<void>;
  listUsers(): Promise<User[]>;
}

export interface SettlementRecoveryReport {
  recovered: string[];
  repairedItems: string[];
  repairedExchanges: string[];
  droppedPending: string[];
}
