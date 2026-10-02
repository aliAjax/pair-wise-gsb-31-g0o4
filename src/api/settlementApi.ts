import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type {
  PendingSettlement,
  SettlementGateway,
  SettlementReceipt,
  SettlementRecoveryReport,
} from '@/models/settlement';
import type { User } from '@/models/user';
import {
  backfillReceipts,
  commitSettlement,
  recoverSettlements,
} from '@/utils/settlementCore';
import { storage, STORAGE_KEYS } from '@/utils/storage';

/**
 * 交割数据网关的浏览器本地实现。
 * 物品状态一律整表读-改-整表写，两侧状态绑定在同一次写入里。
 */
const storageGateway: SettlementGateway = {
  listReceipts: () => storage.get<SettlementReceipt[]>(STORAGE_KEYS.receipts, []),
  writeReceipts: async (receipts) => {
    await storage.set(STORAGE_KEYS.receipts, receipts);
  },
  getPending: () => storage.get<PendingSettlement | null>(STORAGE_KEYS.settlementPending, null),
  setPending: async (pending) => {
    if (pending) {
      await storage.set(STORAGE_KEYS.settlementPending, pending);
    } else {
      await storage.remove(STORAGE_KEYS.settlementPending);
    }
  },
  listExchanges: () => storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []),
  writeExchanges: async (exchanges) => {
    await storage.set(STORAGE_KEYS.exchanges, exchanges);
  },
  listItems: () => storage.get<Item[]>(STORAGE_KEYS.items, []),
  writeItems: async (items) => {
    await storage.set(STORAGE_KEYS.items, items);
  },
  listUsers: () => storage.get<User[]>(STORAGE_KEYS.users, []),
};

export const settlementApi = {
  gateway: storageGateway,

  async list(): Promise<SettlementReceipt[]> {
    return storageGateway.listReceipts();
  },

  /** 按物品 id 查成交依据（首页、详情页展示同一份交割单） */
  async listByItem(itemId: string): Promise<SettlementReceipt[]> {
    const receipts = await storageGateway.listReceipts();
    return receipts.filter(
      (receipt) => receipt.from_item.id === itemId || receipt.to_item.id === itemId,
    );
  },

  async getByExchange(exchangeId: string): Promise<SettlementReceipt | undefined> {
    const receipts = await storageGateway.listReceipts();
    return receipts.find((receipt) => receipt.exchange_id === exchangeId);
  },

  /**
   * 完成交换并生成不可改交割单。
   * 内部两阶段提交，失败可安全重试：物品两侧状态一起补、交割单绝不重复。
   */
  async settle(exchangeId: string): Promise<{ receipt: SettlementReceipt; recovered: boolean }> {
    return commitSettlement(storageGateway, exchangeId);
  },

  /** 启动时：恢复未落盘交割，再按完成时间回填旧数据 */
  async recover(): Promise<SettlementRecoveryReport> {
    return recoverSettlements(storageGateway);
  },

  /** 供旧数据升级流程单独触发回填 */
  async backfill(): Promise<SettlementReceipt[]> {
    const { receipts } = await backfillReceipts(storageGateway);
    await storage.set(STORAGE_KEYS.settlementMigratedAt, new Date().toISOString());
    return receipts;
  },
};
