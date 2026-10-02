<template>
  <section class="page home-page">
    <div class="page-heading home-heading">
      <div>
        <p class="eyebrow">本地以物换物</p>
        <h1>把闲置重新放回生活里</h1>
      </div>
      <RouterLink class="primary-link" to="/publish">发布闲置</RouterLink>
    </div>

    <div class="toolbar">
      <van-search v-model="itemStore.keyword" placeholder="搜索物品、描述或地点" />
      <CategoryFilter v-model="itemStore.category" />
    </div>

    <div v-if="itemStore.visibleItems.length" class="waterfall">
      <ItemCard
        v-for="item in itemStore.visibleItems"
        :key="item.id"
        :item="item"
        :owner="ownerOf(item.user_id)"
      />
    </div>
    <EmptyState
      v-else
      mark="空"
      title="没有找到可交换物品"
      :description="PAGE_MESSAGES.homeEmpty"
    />

    <section v-if="latestReceipts.length" class="home-receipts">
      <div class="page-heading">
        <div>
          <p class="eyebrow">不可改交割单</p>
          <h2>最近成交依据</h2>
        </div>
      </div>
      <div class="home-receipts__list">
        <ReceiptCard v-for="receipt in latestReceipts" :key="receipt.id" :receipt="receipt" compact />
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Search as VanSearch } from 'vant';

import CategoryFilter from '@/components/common/CategoryFilter.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ItemCard from '@/components/common/ItemCard.vue';
import ReceiptCard from '@/components/common/ReceiptCard.vue';
import { PAGE_MESSAGES } from '@/constants/messages';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore } from '@/stores/authStore';
import { useItemStore } from '@/stores/itemStore';
import { useSettlementStore } from '@/stores/settlementStore';

const itemStore = useItemStore();
const authStore = useAuthStore();
const settlementStore = useSettlementStore();
const ownerOf = (userId: string) => authStore.users.find((user) => user.id === userId);
const savedKeyword = useLocalStorage('reswap:last-home-keyword', '');

// 首页展示的交割单与详情页、交换页来自同一个 store，成交依据只有一份
const latestReceipts = computed(() => [...settlementStore.receipts].sort((a, b) => b.seq - a.seq).slice(0, 3));

onMounted(() => {
  if (!itemStore.keyword && savedKeyword.value) {
    itemStore.keyword = savedKeyword.value;
  }
});

watch(
  () => itemStore.keyword,
  (value) => {
    savedKeyword.value = value;
  },
);
</script>
