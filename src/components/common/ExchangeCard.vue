<template>
  <article class="exchange-card">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(exchange.updated_at) }}</small>
    </header>
    <div class="exchange-card__items">
      <div>
        <span>拿出</span>
        <strong>{{ displayFromTitle }}</strong>
      </div>
      <div>
        <span>换取</span>
        <strong>{{ displayToTitle }}</strong>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>
    <footer>
      <span>{{ displayFromName }} → {{ displayToName }}</span>
      <div v-if="canOperate" class="exchange-card__actions">
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="$emit('accept', exchange.id)">
          同意
        </button>
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="$emit('reject', exchange.id)">
          拒绝
        </button>
        <button v-if="exchange.status === ExchangeStatus.ACCEPTED" type="button" @click="$emit('complete', exchange.id)">
          完成
        </button>
      </div>
    </footer>
    <ReceiptCard v-if="receipt" :receipt="receipt" compact />
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import ReceiptCard from '@/components/common/ReceiptCard.vue';
import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { SettlementReceipt } from '@/models/settlement';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { formatDate, formatExchangeStatus, formatStatusMessage, statusToneClass } from '@/utils/formatters';

const props = defineProps<{
  exchange: Exchange;
  items: Item[];
  users: User[];
  /** 已完成交换的不可改成交依据；存在时标题/双方一律取快照，不读实时物品 */
  receipt?: SettlementReceipt;
}>();

defineEmits<{
  accept: [id: string];
  reject: [id: string];
  complete: [id: string];
}>();

const authStore = useAuthStore();
const liveFromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const liveToItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const liveFromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const liveToUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));

// 成交后以交割单快照为准：物品改名/下架不改变这里的展示
const displayFromTitle = computed(() =>
  props.receipt ? props.receipt.from_item.title : (liveFromItem.value?.title ?? '未知物品'),
);
const displayToTitle = computed(() =>
  props.receipt ? props.receipt.to_item.title : (liveToItem.value?.title ?? '未知物品'),
);
const displayFromName = computed(() =>
  props.receipt ? props.receipt.from_user.nickname : (liveFromUser.value?.nickname ?? '未知用户'),
);
const displayToName = computed(() =>
  props.receipt ? props.receipt.to_user.nickname : (liveToUser.value?.nickname ?? '未知用户'),
);
const canOperate = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    (authStore.currentUser?.id === props.exchange.from_user_id && props.exchange.status === ExchangeStatus.ACCEPTED),
);
</script>
