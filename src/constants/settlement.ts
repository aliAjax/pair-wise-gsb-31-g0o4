/**
 * 交割单相关常量。
 * 交割单是完成交换的唯一成交依据，跨首页 / 详情 / 交换页共用。
 */
export const SETTLEMENT_SCHEMA_VERSION = 1;

/** 交割单 id 前缀，实际 id 为 `${PREFIX}${exchangeId}`，用于重试幂等去重 */
export const RECEIPT_ID_PREFIX = 'receipt_';

export const deriveReceiptId = (exchangeId: string) => `${RECEIPT_ID_PREFIX}${exchangeId}`;

export const SETTLEMENT_STORAGE_HINTS = {
  receiptsKey: 'reswap:settlements',
  pendingKey: 'reswap:settlement-pending',
  touchedBy: [
    'models/settlement.ts',
    'api/settlementApi.ts',
    'utils/settlementCore.ts',
    'stores/settlementStore.ts',
    'components/common/ReceiptCard.vue',
  ],
};

/** 交割单锁定提示文案的 key，避免各页面自行编造成交依据 */
export const RECEIPT_LOCK_HINT = '交割单一经生成不可修改，物品改名或下架后仍显示成交时内容';
