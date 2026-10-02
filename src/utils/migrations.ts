import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { Settlement } from '@/models/settlement';
import type { User } from '@/models/user';
import { storage, STORAGE_KEYS } from '@/utils/storage';

import { itemApi } from '@/api/itemApi';
import { settlementApi } from '@/api/settlementApi';
import { userApi } from '@/api/userApi';

const CURRENT_SCHEMA_VERSION = 2;

interface MigrationResult {
  upgraded: boolean;
  backfilled: number;
}

const readPayload = async <T>(key: string): Promise<T | null> => {
  const envelope = await storage.getRaw<T>(key);
  return envelope?.payload ?? null;
};

/** 把任意旧版本信封按当前版本重写一遍，保证之后 storage.get 能直接命中。 */
const rewriteAtCurrentVersion = async <T>(key: string, payload: T) => {
  await storage.set(key, payload);
};

/**
 * v1 -> v2：
 * 1. 读出旧版本的 users/items/exchanges（不删除、不覆盖未读的旧数据）；
 * 2. 用当前版本信封重写，完成结构升级；
 * 3. 已完成交换按完成时间（updated_at）从早到晚回填交割单；
 * 4. 写入 schema 版本标记。
 * 全程幂等：升级到一半刷新页面后重跑，已回填的交割单不会重复。
 */
export const runMigrations = async (): Promise<MigrationResult> => {
  const schemaVersion = Number(localStorage.getItem(STORAGE_KEYS.schemaVersion) ?? '0');
  if (schemaVersion >= CURRENT_SCHEMA_VERSION) {
    return { upgraded: false, backfilled: 0 };
  }

  const usersEnvelope = await storage.getRaw<User[]>(STORAGE_KEYS.users);
  const itemsEnvelope = await storage.getRaw<Item[]>(STORAGE_KEYS.items);
  const exchangesEnvelope = await storage.getRaw<Exchange[]>(STORAGE_KEYS.exchanges);

  const hasLegacyData = Boolean(usersEnvelope || itemsEnvelope || exchangesEnvelope);
  if (!hasLegacyData) {
    // 全新用户：种子数据将由各 api 首次读取时写入，直接登记当前版本。
    localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
    return { upgraded: false, backfilled: 0 };
  }

  const users = (await readPayload<User[]>(STORAGE_KEYS.users)) ?? [];
  const items = (await readPayload<Item[]>(STORAGE_KEYS.items)) ?? [];
  const exchanges = (await readPayload<Exchange[]>(STORAGE_KEYS.exchanges)) ?? [];

  await rewriteAtCurrentVersion(STORAGE_KEYS.users, users);
  await rewriteAtCurrentVersion(STORAGE_KEYS.items, items);
  await rewriteAtCurrentVersion(STORAGE_KEYS.exchanges, exchanges);

  const existingSettlements = (await readPayload<Settlement[]>(STORAGE_KEYS.settlements)) ?? [];
  if (existingSettlements.length) {
    await rewriteAtCurrentVersion(STORAGE_KEYS.settlements, existingSettlements);
  }

  const { backfilled } = await settlementApi.backfillCompleted(
    exchanges,
    items.length ? items : await itemApi.list(),
    users.length ? users : await userApi.list(),
    existingSettlements,
  );

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
  return { upgraded: true, backfilled };
};
