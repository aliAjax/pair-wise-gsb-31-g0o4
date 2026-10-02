import type { Item } from '@/models/item';
import type { Settlement, SettlementItemSnapshot, SettlementUserSnapshot } from '@/models/settlement';
import type { User } from '@/models/user';

/** 深拷贝物品成交瞬间内容。交割单只保留快照，之后 Item 改名/下架与快照无关。 */
export const toItemSnapshot = (item: Item): SettlementItemSnapshot => ({
  item_id: item.id,
  user_id: item.user_id,
  title: item.title,
  description: item.description,
  category: item.category,
  condition: item.condition,
  images: [...item.images],
  status: item.status,
  location: item.location,
});

/** 深拷贝双方资料快照，用户事后改昵称/电话不影响历史交割依据。 */
export const toUserSnapshot = (user: User): SettlementUserSnapshot => ({
  user_id: user.id,
  nickname: user.nickname,
  avatar: user.avatar,
  phone: user.phone,
  location: user.location,
  credit_score: user.credit_score,
});

export const isCompleteSettlement = (receipt: Partial<Settlement> | null | undefined): receipt is Settlement =>
  Boolean(
    receipt &&
      receipt.id &&
      receipt.exchange_id &&
      receipt.from_item?.item_id &&
      receipt.to_item?.item_id &&
      receipt.from_user?.user_id &&
      receipt.to_user?.user_id &&
      receipt.completed_at,
  );
