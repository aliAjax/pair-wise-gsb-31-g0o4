<template>
  <article class="receipt-card" :class="{ 'receipt-card--compact': compact }">
    <header class="receipt-card__head">
      <span class="status-pill status-done">交割单 No.{{ String(receipt.seq).padStart(4, '0') }}</span>
      <small>{{ formatDate(receipt.completed_at) }}</small>
    </header>
    <div class="receipt-card__items">
      <div class="receipt-card__side">
        <span>拿出</span>
        <strong>{{ receipt.from_item.title }}</strong>
        <small>
          {{ receipt.from_item.category }} · {{ formatCondition(receipt.from_item.condition) }}
        </small>
        <small class="receipt-card__user">{{ receipt.from_user.nickname }}</small>
      </div>
      <div class="receipt-card__arrow" aria-hidden="true">⇄</div>
      <div class="receipt-card__side">
        <span>换取</span>
        <strong>{{ receipt.to_item.title }}</strong>
        <small>
          {{ receipt.to_item.category }} · {{ formatCondition(receipt.to_item.condition) }}
        </small>
        <small class="receipt-card__user">{{ receipt.to_user.nickname }}</small>
      </div>
    </div>
    <p v-if="!compact" class="receipt-card__note">
      <span v-if="receipt.backfilled" class="receipt-card__tag">历史数据回填</span>
      {{ RECEIPT_LOCK_HINT }}
    </p>
  </article>
</template>

<script setup lang="ts">
import { RECEIPT_LOCK_HINT } from '@/constants/settlement';
import type { SettlementReceipt } from '@/models/settlement';
import { formatCondition, formatDate } from '@/utils/formatters';

defineProps<{
  receipt: SettlementReceipt;
  compact?: boolean;
}>();
</script>
