<template>
  <van-config-provider :theme="vantTheme">
    <GlobalErrorBoundary>
      <div class="app-shell">
        <header class="topbar">
          <RouterLink class="brand" to="/home">
            <span>ReSwap</span>
            <small>物尽其用</small>
          </RouterLink>
          <nav>
            <RouterLink to="/home">首页</RouterLink>
            <RouterLink to="/publish">发布</RouterLink>
            <RouterLink to="/exchanges">交换</RouterLink>
            <RouterLink to="/profile">我的</RouterLink>
          </nav>
          <button class="theme-toggle" type="button" @click="themeStore.toggle">
            {{ themeStore.token.label }}
          </button>
        </header>
        <main>
          <RouterView />
        </main>
      </div>
    </GlobalErrorBoundary>
  </van-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { ConfigProvider as VanConfigProvider } from 'vant';

import GlobalErrorBoundary from '@/components/common/GlobalErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { useSettlementStore } from '@/stores/settlementStore';
import { useThemeStore } from '@/stores/themeStore';
import { message } from '@/utils/message';
import { runMigrations } from '@/utils/migrations';
import { toVantTheme } from '@/utils/themeUtils';

const authStore = useAuthStore();
const itemStore = useItemStore();
const exchangeStore = useExchangeStore();
const settlementStore = useSettlementStore();
const themeStore = useThemeStore();
const vantTheme = computed(() => toVantTheme(themeStore.theme));

onMounted(async () => {
  themeStore.hydrate();
  // 旧数据先升级：已完成交换按完成时间回填交割单，之后各 store 才能读到一致数据。
  const migration = await runMigrations();
  await Promise.all([
    authStore.hydrate(),
    itemStore.hydrate(),
    exchangeStore.hydrate(),
    settlementStore.hydrate(),
  ]);
  // 上次写入若中断在某一步，从最近完整交割单向回补齐，且不重复生成记录。
  await settlementStore.recover();
  if (migration.upgraded && migration.backfilled > 0) {
    message(`旧数据已按完成时间回填 ${migration.backfilled} 张交割单`, 'success');
  }
});
</script>
