<script setup lang="ts">
import { CircleAlert, CircleCheck, GitBranch, RefreshCw } from 'lucide-vue-next';
import type { BuildRecord } from '../types/build';

defineProps<{ history: BuildRecord[] }>();

function date(value: string) { return new Date(value).toLocaleString(); }
function duration(value: number | null) { return value === null ? '—' : `${(value / 1000).toFixed(1)}s`; }
</script>

<template>
  <section class="history-section"><div class="section-heading"><span>构建历史</span><span class="count">{{ history.length }}</span></div><div v-if="!history.length" class="empty">暂无构建记录</div><div v-for="record in history" :key="record.id" class="history-row"><span class="history-icon" :class="record.status"><CircleCheck v-if="record.status === 'success'" :size="17" /><CircleAlert v-else-if="record.status === 'failed'" :size="17" /><RefreshCw v-else :size="17" /></span><span class="history-status" :class="record.status">{{ record.status }}</span><span class="history-branch"><GitBranch :size="13" />{{ record.branch }}</span><span class="history-time">{{ date(record.time) }}</span><span class="history-duration">{{ duration(record.duration) }}</span></div></section>
</template>
