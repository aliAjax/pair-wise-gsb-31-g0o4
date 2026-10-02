import { ItemCondition, ItemStatus } from '@/constants/item';
import type { Exchange } from '@/models/exchange';

/**
 * 交割单内的物品快照。
 * 交割完成后物品改名、下架、删除都不允许回写这些字段，
 * 因此刻意不引用 Item，保证快照与活动数据完全解耦。
 */
export interface SettlementItemSnapshot {
  item_id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  images: string[];
  status: ItemStatus;
  location: string;
}

/** 交割单内的双方资料快照，同样不引用 User。 */
export interface SettlementUserSnapshot {
  user_id: string;
  nickname: string;
  avatar: string;
  phone: string;
  location: string;
  credit_score: number;
}

/**
 * 交割单（不可变凭证）。
 * - id 由 exchangeId 确定性派生，重试不会生成第二条；
 * - 成交瞬间冻结物品和资料快照，后续只允许读取；
 * - completed_at 取成交确认时间，旧数据升级时按它排序回填。
 */
export interface Settlement {
  id: string;
  exchange_id: string;
  from_user_id: string;
  to_user_id: string;
  from_item: SettlementItemSnapshot;
  to_item: SettlementItemSnapshot;
  from_user: SettlementUserSnapshot;
  to_user: SettlementUserSnapshot;
  message: string;
  completed_at: string;
  created_at: string;
}

export type SettlementSnapshotInput = Pick<
  Exchange,
  'from_user_id' | 'to_user_id' | 'from_item_id' | 'to_item_id' | 'message'
>;
