<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { BuildStatus } from '../../types/dashboard';

const props = defineProps<{
  buildStatus: BuildStatus;
  buildTimer: string | null;
  formattedLogs: string;
  autoScroll: boolean;
}>();

const emit = defineEmits<{
  'update:auto-scroll': [enabled: boolean];
  clear: [];
  abort: [];
}>();
const consoleBody = ref<HTMLDivElement | null>(null);

const scrollToBottom = () => {
  if (!props.autoScroll) return;
  nextTick(() => {
    if (consoleBody.value) {
      consoleBody.value.scrollTop = consoleBody.value.scrollHeight;
    }
  });
};

watch(() => props.formattedLogs, scrollToBottom);
watch(() => props.autoScroll, (enabled) => {
  if (enabled) scrollToBottom();
});

const handleAutoScrollChange = (event: Event) => {
  if (event.target instanceof HTMLInputElement) {
    emit('update:auto-scroll', event.target.checked);
  }
};
</script>

<template>
  <div class="console-card">
    <div class="console-header">
      <div class="console-title">
        <span class="status-dot" :class="buildStatus.status"></span>
        <span>{{ buildStatus.currentTask || '控制台空闲就绪' }}</span>
        <span v-if="buildTimer" style="color: #38bdf8; font-size: 12px;">[{{ buildTimer }}]</span>
      </div>

      <div style="display: flex; gap: 8px; align-items: center;">
        <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; color: var(--text-muted);">
          <input
            type="checkbox"
            :checked="autoScroll"
            @change="handleAutoScrollChange"
          >
          <span>自动滚屏</span>
        </label>
        <button class="btn btn-default btn-sm" @click="$emit('clear')">清屏</button>
        <button v-if="buildStatus.status === 'running'" class="btn btn-danger btn-sm" @click="$emit('abort')">
          中止任务
        </button>
      </div>
    </div>

    <div ref="consoleBody" class="console-body">
      <div v-html="formattedLogs"></div>
    </div>
  </div>
</template>
