<template>
  <article class="exchange-card">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(settlement ? settlement.completed_at : exchange.updated_at) }}</small>
    </header>
    <div class="exchange-card__items">
      <div>
        <span>拿出</span>
        <strong>{{ displayFromTitle }}</strong>
        <small v-if="settlement">{{ settlement.from_user.nickname }}</small>
      </div>
      <div>
        <span>换取</span>
        <strong>{{ displayToTitle }}</strong>
        <small v-if="settlement">{{ settlement.to_user.nickname }}</small>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>

    <!-- 已完成交换统一展示不可改交割单，物品改名/下架后仍显示成交时内容 -->
    <SettlementNote v-if="settlement" :receipt="settlement" variant="card" :items="items" />

    <footer>
      <span v-if="fromUser && toUser && !settlement">{{ fromUser.nickname }} → {{ toUser.nickname }}</span>
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
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import SettlementNote from '@/components/common/SettlementNote.vue';
import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useSettlementStore } from '@/stores/settlementStore';
import { formatDate, formatExchangeStatus, formatStatusMessage, statusToneClass } from '@/utils/formatters';

const props = defineProps<{
  exchange: Exchange;
  items: Item[];
  users: User[];
}>();

defineEmits<{
  accept: [id: string];
  reject: [id: string];
  complete: [id: string];
}>();

const authStore = useAuthStore();
const settlementStore = useSettlementStore();
const fromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const toItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const fromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));

// 已完成：以交割单冻结标题为准；未完成：回退查活动物品。
const settlement = computed(() => settlementStore.byExchange(props.exchange.id));
const displayFromTitle = computed(
  () => settlement.value?.from_item.title ?? fromItem.value?.title ?? '未知物品',
);
const displayToTitle = computed(
  () => settlement.value?.to_item.title ?? toItem.value?.title ?? '未知物品',
);

const canOperate = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    (authStore.currentUser?.id === props.exchange.from_user_id && props.exchange.status === ExchangeStatus.ACCEPTED),
);
</script>
