import type { ExchangeStatus } from '@/constants/exchange';
import type { ItemCondition, ItemStatus } from '@/constants/item';

export interface Option<T extends string> {
  label: string;
  value: T;
}

export interface PersistedEnvelope<T> {
  version: number;
  expiresAt?: number;
  payload: T;
}

/** storage.getRaw 返回的原始信封，供版本迁移层判断是否需要升级。 */
export type RawEnvelope<T> = PersistedEnvelope<T> | null;

/** 旧数据升级交割单时的回填结果，迁移与恢复共用。 */
export interface SettlementBackfillStats {
  backfilled: number;
  repaired: number;
}

export interface StatusFilter {
  item?: ItemStatus;
  exchange?: ExchangeStatus;
  condition?: ItemCondition;
}

export interface ImageFilePayload {
  id: string;
  name: string;
  dataUrl: string;
}
