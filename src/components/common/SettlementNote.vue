<template>
  <aside class="settlement-note" :class="`settlement-note--${variant}`">
    <header class="settlement-note__head">
      <strong>{{ SETTLEMENT_MESSAGES.receiptTitle }}</strong>
      <span class="status-pill status-done">{{ PAGE_MESSAGES.settlementBasis }}</span>
    </header>

    <p class="settlement-note__no">
      {{ SETTLEMENT_MESSAGES.receiptNoLabel }}：{{ formatSettlementNo(receipt.id) }}
    </p>

    <div class="settlement-note__items">
      <div>
        <span>{{ SETTLEMENT_MESSAGES.fromLabel }}</span>
        <strong>{{ receipt.from_item.title }}</strong>
        <small>{{ receipt.from_user.nickname }} · {{ formatCondition(receipt.from_item.condition) }}</small>
      </div>
      <div>
        <span>{{ SETTLEMENT_MESSAGES.toLabel }}</span>
        <strong>{{ receipt.to_item.title }}</strong>
        <small>{{ receipt.to_user.nickname }} · {{ formatCondition(receipt.to_item.condition) }}</small>
      </div>
    </div>

    <p class="settlement-note__time">
      {{ SETTLEMENT_MESSAGES.completedAtLabel }}：{{ formatDate(receipt.completed_at) }}
    </p>

    <ul v-if="hints.length" class="settlement-note__hints">
      <li v-for="hint in hints" :key="hint">⚑ {{ hint }}</li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { PAGE_MESSAGES, SETTLEMENT_MESSAGES } from '@/constants/messages';
import type { Settlement } from '@/models/settlement';
import type { Item } from '@/models/item';
import { formatCondition, formatDate, formatSettlementNo } from '@/utils/formatters';

/**
 * 交割依据展示块。所有数据来自不可变交割单快照，
 * 可选传入活动 items 仅用于生成“已改名/已下架”提示，绝不替换快照标题。
 */
const props = withDefaults(
  defineProps<{
    receipt: Settlement;
    variant?: 'card' | 'panel';
    items?: Item[];
  }>(),
  { variant: 'card', items: () => [] },
);

const itemHint = (snapshotId: string, snapshotTitle: string) => {
  const current = props.items.find((item) => item.id === snapshotId);
  if (!current) return SETTLEMENT_MESSAGES.offlineHint;
  if (current.title !== snapshotTitle) {
    return `${SETTLEMENT_MESSAGES.renamedHint}（${SETTLEMENT_MESSAGES.currentNameHint}：${current.title}）`;
  }
  return '';
};

const hints = computed(() =>
  [
    itemHint(props.receipt.from_item.item_id, props.receipt.from_item.title),
    itemHint(props.receipt.to_item.item_id, props.receipt.to_item.title),
  ].filter(Boolean),
);
</script>
