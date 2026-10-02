/** 交割单相关常量：存储键、快照结构、恢复策略的元信息集中在此。 */
export const SETTLEMENT_STORAGE_HINTS = {
  statusKey: 'reswap:settlements',
  /** 交割单一旦写入不可修改，任何枚举调整都不允许动历史快照。 */
  immutable: true,
  /** 写入失败后的恢复顺序：从最近一张完整交割单向回修复。 */
  recoverOrder: 'desc:completed_at',
  /** 两侧物品状态必须在同一次写入里补齐，禁止只改一侧。 */
  atomicItemPair: true,
  statusTouchedBy: [
    'models/settlement.ts',
    'api/settlementApi.ts',
    'stores/settlementStore.ts',
    'components/common/ExchangeCard.vue',
    'components/common/ItemCard.vue',
    'components/common/SettlementNote.vue',
  ],
};

/** 交割单编号展示用的分隔前缀，存储 id 形如 settlement_<exchangeId>。 */
export const SETTLEMENT_ID_PREFIX = 'settlement_';
