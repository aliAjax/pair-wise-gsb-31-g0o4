<template>
  <RouterLink class="item-card" :to="`/item/${item.id}`">
    <ItemImageGallery :images="item.images" :fallback-text="item.category" />
    <div class="item-card__body">
      <div class="item-card__topline">
        <span class="pill">{{ item.category }}</span>
        <span class="status-pill" :class="statusToneClass(item.status)">{{ formatItemStatus(item.status) }}</span>
      </div>
      <h3>{{ item.title }}</h3>
      <p>{{ item.description }}</p>
      <div class="item-card__meta">
        <span>{{ item.location }}</span>
        <span>{{ formatCondition(item.condition) }}</span>
      </div>
      <div class="item-card__owner">
        <span v-if="owner">{{ owner.nickname }}</span>
        <span v-if="isMine" class="mine">我的</span>
      </div>
      <div v-if="latestReceipt" class="item-card__receipt">
        成交依据：交割单 No.{{ String(latestReceipt.seq).padStart(4, '0') }} ·
        成交时「{{ latestReceipt.from_item.id === item.id ? latestReceipt.from_item.title : latestReceipt.to_item.title }}」
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import type { Item } from '@/models/item';
import type { SettlementReceipt } from '@/models/settlement';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useSettlementStore } from '@/stores/settlementStore';
import { useThemeStore } from '@/stores/themeStore';
import { formatCondition, formatItemStatus, statusToneClass } from '@/utils/formatters';

import ItemImageGallery from './ItemImageGallery.vue';

const props = defineProps<{
  item: Item;
  owner?: User;
}>();

const authStore = useAuthStore();
const settlementStore = useSettlementStore();
useThemeStore();
const isMine = computed(() => authStore.currentUser?.id === props.item.user_id);
// 与详情页、交换页同源的成交依据；物品改名后这里仍显示成交时标题
const latestReceipt = computed<SettlementReceipt | undefined>(() => {
  const matched = settlementStore.byItem(props.item.id);
  return matched.length ? matched[matched.length - 1] : undefined;
});
</script>
