import { defineStore } from 'pinia';

import { settlementApi } from '@/api/settlementApi';
import type { SettlementReceipt } from '@/models/settlement';
import { message } from '@/utils/message';

/**
 * 交割单是全应用唯一的成交依据：首页、物品详情、交换管理页都从这里取数，
 * 保证三个页面看到的是同一份不可改快照。
 */
export const useSettlementStore = defineStore('settlements', {
  state: () => ({
    receipts: [] as SettlementReceipt[],
    recovered: false,
    recovering: false,
  }),
  getters: {
    /** 某笔交换的成交依据 */
    byExchange: (state) => (exchangeId: string) =>
      state.receipts.find((receipt) => receipt.exchange_id === exchangeId),
    /** 某件物品参与过的全部交割（正常只有一笔） */
    byItem: (state) => (itemId: string) =>
      state.receipts.filter((receipt) => receipt.from_item.id === itemId || receipt.to_item.id === itemId),
  },
  actions: {
    async hydrate() {
      this.receipts = await settlementApi.list();
    },
    /**
     * 启动恢复：先补完上次写入中途失败的交割（从最近完整交割单之后继续），
     * 再为旧版本数据按完成时间回填交割单。全程幂等。
     */
    async recover() {
      this.recovering = true;
      try {
        await settlementApi.recover();
        await this.hydrate();
        this.recovered = true;
      } catch (error) {
        // 恢复失败不阻断应用启动，用户仍可重试完成操作（流程本身幂等）
        message(error instanceof Error ? error.message : '交割单恢复失败，请重试', 'error');
      } finally {
        this.recovering = false;
      }
    },
  },
});
