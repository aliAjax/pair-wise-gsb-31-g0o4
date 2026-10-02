import { defineStore } from 'pinia';

import { settlementApi } from '@/api/settlementApi';
import { SETTLEMENT_MESSAGES } from '@/constants/messages';
import type { Settlement } from '@/models/settlement';
import { message } from '@/utils/message';

/**
 * 交割单全局唯一数据源。
 * 首页 ItemCard、物品详情、交换页都从这里取“成交依据”，
 * 保证三处看到的是同一张不可改交割单，而不是各自回查活动物品。
 */
export const useSettlementStore = defineStore('settlements', {
  state: () => ({
    settlements: [] as Settlement[],
    loading: false,
  }),
  getters: {
    byExchange: (state) => (exchangeId: string) =>
      state.settlements.find((receipt) => receipt.exchange_id === exchangeId),
    byItem: (state) => (itemId: string) =>
      state.settlements.find(
        (receipt) => receipt.from_item.item_id === itemId || receipt.to_item.item_id === itemId,
      ),
    /** 一件物品在某张交割单里的对手方物品快照（成交时名称/图片/成色）。 */
    counterpartSnapshot: (state) => (receiptId: string | undefined, itemId: string) => {
      const receipt = state.settlements.find((entry) => entry.id === receiptId);
      if (!receipt) return undefined;
      return receipt.from_item.item_id === itemId ? receipt.to_item : receipt.from_item;
    },
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.settlements = await settlementApi.list();
      } finally {
        this.loading = false;
      }
    },

    /**
     * 启动恢复：从最近完整交割单向回补齐。
     * 仅在确实修复了不一致时提示，幂等扫描不会打扰用户。
     */
    async recover() {
      const repaired = await settlementApi.recoverAll();
      if (repaired > 0) {
        this.settlements = await settlementApi.list();
        message('已从最近完整交割单恢复物品与交换状态', 'success');
      }
      return repaired;
    },

    async completeExchange(exchangeId: string) {
      const { replayed } = await settlementApi.completeExchange(exchangeId);
      message(replayed ? SETTLEMENT_MESSAGES.replayed : SETTLEMENT_MESSAGES.completed, 'success');
    },
  },
});
