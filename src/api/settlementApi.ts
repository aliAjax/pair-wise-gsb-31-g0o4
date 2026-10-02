import { SETTLEMENT_ID_PREFIX } from '@/constants/settlement';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { SETTLEMENT_MESSAGES } from '@/constants/messages';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { Settlement } from '@/models/settlement';
import type { User } from '@/models/user';
import { isCompleteSettlement, toItemSnapshot, toUserSnapshot } from '@/utils/settlementSnapshot';
import { storage, STORAGE_KEYS } from '@/utils/storage';

import { exchangeApi } from './exchangeApi';
import { itemApi } from './itemApi';
import { userApi } from './userApi';

/** 交割单 id 由交换单确定性派生：重试只命中同一 id，绝不生成第二张。 */
export const toSettlementId = (exchangeId: string) => `${SETTLEMENT_ID_PREFIX}${exchangeId}`;

/** 正在进行的完成操作，并发/双击的第二次调用直接等待第一次结果。 */
const inFlight = new Map<string, Promise<{ settlement: Settlement; replayed: boolean }>>();

/**
 * 演示用种子交割单：刻意保留成交时的旧标题，与活动物品的现名/下架状态不同，
 * 用来证明物品后来改名或下架，原交割单仍显示成交时内容。
 */
const seedCompletedAt = new Date(Date.now() - 1000 * 60 * 60 * 80).toISOString();

const buildSeedReceipts = (): Settlement[] => [
  {
    id: toSettlementId('exchange_seed_completed'),
    exchange_id: 'exchange_seed_completed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item: {
      item_id: 'item_headphone',
      user_id: 'user_me',
      title: 'Sony 旧头戴耳机',
      description: '正常使用痕迹，耳罩有点掉皮，不影响佩戴。',
      category: '数码',
      condition: ItemCondition.GOOD,
      images: [],
      status: ItemStatus.EXCHANGED,
      location: '上海 · 徐汇',
    },
    to_item: {
      item_id: 'item_lamp',
      user_id: 'user_lin',
      title: '木质小夜灯',
      description: '暖光，适合床头。',
      category: '家居',
      condition: ItemCondition.LIKE_NEW,
      images: [],
      status: ItemStatus.EXCHANGED,
      location: '杭州 · 西湖',
    },
    from_user: {
      user_id: 'user_me',
      nickname: '青禾',
      avatar: '',
      phone: '13800000001',
      location: '上海 · 徐汇',
      credit_score: 92,
    },
    to_user: {
      user_id: 'user_lin',
      nickname: '林小雨',
      avatar: '',
      phone: '13800000002',
      location: '杭州 · 西湖',
      credit_score: 86,
    },
    message: '旧耳机换小夜灯，已在杭州东站当面交割。',
    completed_at: seedCompletedAt,
    created_at: seedCompletedAt,
  },
];

export const settlementApi = {
  async list(): Promise<Settlement[]> {
    const raw = await storage.get<Settlement[] | null>(STORAGE_KEYS.settlements, null);
    if (raw !== null) {
      // 残缺交割单（写入中途崩溃）不允许出现在任何读取路径。
      return raw.filter(isCompleteSettlement);
    }
    // 只对内置演示数据集补种子交割单；真实老数据（无该交换）不凭空造单。
    const exchanges = await exchangeApi.list();
    if (!exchanges.some((exchange) => exchange.id === 'exchange_seed_completed')) {
      await storage.set(STORAGE_KEYS.settlements, []);
      return [];
    }
    const seeded = buildSeedReceipts();
    await storage.set(STORAGE_KEYS.settlements, seeded);
    return seeded;
  },

  async detailByExchange(exchangeId: string): Promise<Settlement | undefined> {
    const receipts = await this.list();
    return receipts.find((receipt) => receipt.exchange_id === exchangeId);
  },

  async detailByItem(itemId: string): Promise<Settlement | undefined> {
    const receipts = await this.list();
    return receipts.find(
      (receipt) => receipt.from_item.item_id === itemId || receipt.to_item.item_id === itemId,
    );
  },

  /**
   * 由当前活动数据构建一张交割单。旧数据升级时没有真实成交瞬间快照，
   * 按需求只能用升级时刻可见内容回填，但时间仍记录真实完成时间。
   */
  buildReceipt(
    exchange: Exchange,
    items: Item[],
    users: User[],
    completedAt: string,
  ): Settlement {
    const fromItem = items.find((item) => item.id === exchange.from_item_id);
    const toItem = items.find((item) => item.id === exchange.to_item_id);
    const fromUser = users.find((user) => user.id === exchange.from_user_id);
    const toUser = users.find((user) => user.id === exchange.to_user_id);
    if (!fromItem || !toItem) throw new Error(SETTLEMENT_MESSAGES.itemMissing);
    if (!fromUser || !toUser) throw new Error(SETTLEMENT_MESSAGES.userMissing);
    return {
      id: toSettlementId(exchange.id),
      exchange_id: exchange.id,
      from_user_id: exchange.from_user_id,
      to_user_id: exchange.to_user_id,
      from_item: toItemSnapshot(fromItem),
      to_item: toItemSnapshot(toItem),
      from_user: toUserSnapshot(fromUser),
      to_user: toUserSnapshot(toUser),
      message: exchange.message,
      completed_at: completedAt,
      created_at: completedAt,
    };
  },

  /** 直接持久化一批交割单（迁移回填用），按 id 去重，绝不重复生成。 */
  async persistBatch(nextReceipts: Settlement[]): Promise<Settlement[]> {
    const existing = await storage.get<Settlement[]>(STORAGE_KEYS.settlements, []);
    const byId = new Map(existing.map((receipt) => [receipt.id, receipt]));
    nextReceipts.forEach((receipt) => {
      if (!byId.has(receipt.id)) byId.set(receipt.id, receipt);
    });
    const merged = [...byId.values()].filter(isCompleteSettlement);
    await storage.set(STORAGE_KEYS.settlements, merged);
    return merged;
  },

  /**
   * 旧数据升级回填：为所有已完成、但缺少交割单的交换补建交割单。
   * 严格按完成时间（updated_at）从早到晚回填，补过的不再重复生成。
   * 旧版本没有成交瞬间快照，只能用升级时刻可见的物品/资料内容。
   */
  async backfillCompleted(
    exchanges: Exchange[],
    items: Item[],
    users: User[],
    existing: Settlement[] = [],
  ): Promise<{ receipts: Settlement[]; backfilled: number }> {
    const knownIds = new Set(existing.map((receipt) => receipt.id));
    const ordered = exchanges
      .filter((exchange) => exchange.status === ExchangeStatus.COMPLETED)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));

    const receipts: Settlement[] = [];
    ordered.forEach((exchange) => {
      const id = toSettlementId(exchange.id);
      if (knownIds.has(id)) return;
      try {
        receipts.push(this.buildReceipt(exchange, items, users, exchange.updated_at));
        knownIds.add(id);
      } catch {
        // 物品/资料已不可考的历史单跳过，不阻断其他单回填。
      }
    });
    if (receipts.length) await this.persistBatch(receipts);
    return { receipts, backfilled: receipts.length };
  },

  /**
   * 确认交换完成。提交顺序即崩溃恢复协议：
   * 1. 先落不可变交割单（成功后绝不重写）；
   * 2. 同一次写入把两件物品一起置为已交换（禁止只改一侧）；
   * 3. 最后把交换单标记完成。
   * 任何一步失败后重试，已完成的步骤幂等跳过，不会重复生成记录。
   */
  async completeExchange(exchangeId: string): Promise<{ settlement: Settlement; replayed: boolean }> {
    const running = inFlight.get(exchangeId);
    if (running) return running;

    const task = (async (): Promise<{ settlement: Settlement; replayed: boolean }> => {
      const exchanges = await exchangeApi.list();
      const exchange = exchanges.find((entry) => entry.id === exchangeId);
      if (!exchange) throw new Error('交换请求不存在');

      const existed = await this.detailByExchange(exchangeId);
      if (existed) {
        // 交割单已存在 = 上次在第 2/3 步崩溃，从交割单补齐后续，绝不重开一单。
        let replayed = false;
        if (await this.reconcileWith(existed)) replayed = true;
        if (exchange.status !== ExchangeStatus.COMPLETED) {
          await exchangeApi.markCompletedBatch([
            { id: exchangeId, completed_at: existed.completed_at },
          ]);
          replayed = true;
        }
        return { settlement: existed, replayed };
      }

      if (exchange.status !== ExchangeStatus.ACCEPTED) {
        throw new Error(SETTLEMENT_MESSAGES.flowRejected);
      }

      const [items, users] = await Promise.all([itemApi.list(), userApi.list()]);
      const completedAt = new Date().toISOString();
      const receipt = this.buildReceipt(exchange, items, users, completedAt);

      // 第 1 步：不可变交割单先落盘（persistBatch 自带幂等去重）。
      await this.persistBatch([receipt]);

      // 第 2 步：两件物品同一次写入置为已交换。
      await itemApi.setPairStatus(
        [receipt.from_item.item_id, receipt.to_item.item_id],
        ItemStatus.EXCHANGED,
      );

      // 第 3 步：交换单完成，时间锚定交割单成交时间。
      await exchangeApi.markCompletedBatch([{ id: exchangeId, completed_at: receipt.completed_at }]);
      return { settlement: receipt, replayed: false };
    })();

    inFlight.set(exchangeId, task);
    task.finally(() => {
      inFlight.delete(exchangeId);
    });
    return task;
  },

  /** 依据单张交割单补齐物品状态：两侧必须同时补齐，缺一侧则整对重写。 */
  async reconcileWith(receipt: Settlement): Promise<boolean> {
    const items = await itemApi.list();
    const fromItem = items.find((item) => item.id === receipt.from_item.item_id);
    const toItem = items.find((item) => item.id === receipt.to_item.item_id);
    const bothExchanged =
      fromItem?.status === ItemStatus.EXCHANGED && toItem?.status === ItemStatus.EXCHANGED;
    if (bothExchanged) return false;
    await itemApi.setPairStatus(
      [receipt.from_item.item_id, receipt.to_item.item_id],
      ItemStatus.EXCHANGED,
    );
    return true;
  },

  /**
   * 写入失败后的总恢复：从最近一张完整交割单向回扫描，
   * - 两侧物品状态一起补齐（同一次写入，不允许只改一侧）；
   * - 对应交换单统一标记完成（同一次写入）；
   * - 已有交割单不会被重建或重复生成。
   */
  async recoverAll(): Promise<number> {
    const receipts = (await this.list()).sort((a, b) => b.completed_at.localeCompare(a.completed_at));
    if (!receipts.length) return 0;

    let repaired = 0;
    for (const receipt of receipts) {
      if (await this.reconcileWith(receipt)) repaired += 1;
    }

    const exchanges = await exchangeApi.list();
    const pendingCompletion = receipts
      .filter((receipt) =>
        exchanges.some(
          (exchange) =>
            exchange.id === receipt.exchange_id && exchange.status !== ExchangeStatus.COMPLETED,
        ),
      )
      .map((receipt) => ({ id: receipt.exchange_id, completed_at: receipt.completed_at }));
    if (pendingCompletion.length) {
      await exchangeApi.markCompletedBatch(pendingCompletion);
      repaired += pendingCompletion.length;
    }
    return repaired;
  },
};
