import { ExchangeStatus } from './exchange';
import { ItemStatus } from './item';

export const PAGE_MESSAGES = {
  homeEmpty: '暂时没有符合条件的闲置物品',
  publishReady: '发布后会同步写入 localStorage 和 IndexedDB',
  exchangeEmpty: '还没有交换请求，先去首页挑一件合眼缘的物品',
  profileUpdated: '个人资料已更新',
  settlementBasis: '交割依据',
  settlementImmutable: '交割单不可修改，物品改名或下架后仍以成交时内容为准',
  settlementBackfilled: '旧数据已按完成时间回填交割单',
  settlementRecovered: '检测到上次写入不完整，已从最近交割单恢复',
};

export const SETTLEMENT_MESSAGES = {
  completed: '交换已完成，交割单已生成，双方物品状态已更新',
  replayed: '交割单已存在，已按交割单补齐状态，未重复生成记录',
  recovering: '正在从最近完整交割单恢复交换状态…',
  itemMissing: '交割物品缺失，无法生成交割单',
  userMissing: '交割双方资料缺失，无法生成交割单',
  flowRejected: '仅已同意的交换可以确认完成',
  receiptTitle: '交割单',
  fromLabel: '拿出',
  toLabel: '换取',
  completedAtLabel: '成交时间',
  receiptNoLabel: '交割单号',
  currentNameHint: '物品现名',
  offlineHint: '该物品已下架，交割单仍保留成交时内容',
  renamedHint: '物品后来已改名，交割单显示成交时名称',
};

export const FORM_MESSAGES = {
  requiredTitle: '物品标题不能为空',
  requiredDescription: '请描述你希望交换的物品',
  requiredPhone: '请填写联系方式',
  imageLimit: '最多上传 4 张图片',
  exchangeNeedOwnItem: '请先发布一件可交换物品',
};

export const LOG_MESSAGES = {
  storageHydrated: 'storage hydrated with status maps',
  itemStatusUsed: `ItemStatus includes ${ItemStatus.AVAILABLE}, ${ItemStatus.EXCHANGED}, ${ItemStatus.OFFLINE}`,
  exchangeStatusUsed: `ExchangeStatus includes ${ExchangeStatus.PENDING}, ${ExchangeStatus.ACCEPTED}, ${ExchangeStatus.REJECTED}, ${ExchangeStatus.COMPLETED}`,
};

export const STATUS_MESSAGE_MAP = {
  [ItemStatus.AVAILABLE]: '这件物品可发起交换',
  [ItemStatus.EXCHANGED]: '这件物品已完成交换',
  [ItemStatus.OFFLINE]: '这件物品已下架',
  [ExchangeStatus.PENDING]: '等待对方确认',
  [ExchangeStatus.ACCEPTED]: '交换已同意，可确认完成',
  [ExchangeStatus.REJECTED]: '交换请求已拒绝',
  [ExchangeStatus.COMPLETED]: '交换流程已完成',
};
