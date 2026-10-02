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
      <!-- 成交依据：标题/状态均取自不可改交割单快照，物品改名或下架后这里不变 -->
      <div v-if="receipt" class="item-card__deal">
        <span class="status-pill status-done">交割依据</span>
        <small>
          成交换得「{{ counterpart?.title ?? '未知物品' }}」 · {{ formatDate(receipt.completed_at) }}
        </small>
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useSettlementStore } from '@/stores/settlementStore';
import { useThemeStore } from '@/stores/themeStore';
import { formatCondition, formatDate, formatItemStatus, statusToneClass } from '@/utils/formatters';

import ItemImageGallery from './ItemImageGallery.vue';

const props = defineProps<{
  item: Item;
  owner?: User;
}>();

const authStore = useAuthStore();
const settlementStore = useSettlementStore();
useThemeStore();
const isMine = computed(() => authStore.currentUser?.id === props.item.user_id);
// 首页与个人中心共用同一张交割单依据，不回查可能已改名的活动物品标题。
const receipt = computed(() => settlementStore.byItem(props.item.id));
const counterpart = computed(() =>
  receipt.value
    ? settlementStore.counterpartSnapshot(receipt.value.id, props.item.id)
    : undefined,
);
</script>
