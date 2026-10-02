import { EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeDraft } from '@/models/exchange';

import { itemApi } from './itemApi';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const completedAtSeed = new Date(Date.now() - 1000 * 60 * 60 * 80).toISOString();

const seedExchanges: Exchange[] = [
  {
    id: 'exchange_seed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item_id: 'item_chair',
    to_item_id: 'item_camera',
    status: ExchangeStatus.PENDING,
    message: '露营椅换拍立得，可以同城当面交换。',
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
  {
    id: 'exchange_seed_completed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item_id: 'item_headphone',
    to_item_id: 'item_lamp',
    status: ExchangeStatus.COMPLETED,
    message: '旧耳机换小夜灯，已在杭州东站当面交割。',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 82).toISOString(),
    updated_at: completedAtSeed,
  },
];

export const exchangeApi = {
  async list(): Promise<Exchange[]> {
    const exchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    if (exchanges.length) return exchanges;
    await storage.set(STORAGE_KEYS.exchanges, seedExchanges);
    return seedExchanges;
  },

  async create(draft: ExchangeDraft): Promise<Exchange> {
    const exchanges = await this.list();
    const targetItem = await itemApi.detail(draft.to_item_id);
    if (!targetItem || targetItem.status !== ItemStatus.AVAILABLE) {
      throw new Error('目标物品当前不可交换');
    }
    const nextExchange: Exchange = {
      ...draft,
      id: storage.createId('exchange'),
      status: draft.status ?? ExchangeStatus.PENDING,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await storage.set(STORAGE_KEYS.exchanges, [nextExchange, ...exchanges]);
    return nextExchange;
  },

  async transition(id: string, status: ExchangeStatus): Promise<Exchange> {
    const exchanges = await this.list();
    const current = exchanges.find((item) => item.id === id);
    if (!current) throw new Error('交换请求不存在');
    if (!EXCHANGE_ACTION_FLOW[current.status].includes(status)) {
      throw new Error('当前状态不允许该操作');
    }
    const nextExchange: Exchange = { ...current, status, updated_at: new Date().toISOString() };
    await storage.set(
      STORAGE_KEYS.exchanges,
      exchanges.map((item) => (item.id === id ? nextExchange : item)),
    );
    return nextExchange;
  },

  /**
   * 把一批交换单标记完成（交割恢复专用）。
   * 交割单是完成状态的唯一依据：completed_at 固定为成交时间，
   * 恢复重放时不得刷新 updated_at，否则会抹掉真实成交顺序。
   */
  async markCompletedBatch(entries: Array<{ id: string; completed_at: string }>): Promise<Exchange[]> {
    const exchanges = await this.list();
    const patch = new Map(entries.map((entry) => [entry.id, entry.completed_at]));
    const nextExchanges = exchanges.map((item) =>
      patch.has(item.id)
        ? { ...item, status: ExchangeStatus.COMPLETED, updated_at: patch.get(item.id) ?? item.updated_at }
        : item,
    );
    await storage.set(STORAGE_KEYS.exchanges, nextExchanges);
    return nextExchanges;
  },
};
