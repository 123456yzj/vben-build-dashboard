<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { Terminal } from 'lucide-vue-next';
import type { BuildLog, BuildRecord } from '../types/build';

const props = defineProps<{ logs: BuildLog[]; latestBuild: BuildRecord | null; connected: boolean }>();
const terminal = ref<HTMLElement | null>(null);

function scrollTerminal() {
  void nextTick(() => { if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight; });
}

onMounted(scrollTerminal);
watch(() => props.logs.at(-1), scrollTerminal);
</script>

<template>
  <section class="terminal-section"><div class="terminal-header"><div class="terminal-title"><Terminal :size="16" /> TERMINAL <span class="terminal-subtitle">{{ latestBuild?.status === 'running' ? 'BUILD RUNNING' : 'OUTPUT' }}</span></div><span class="live-tag"><span class="dot" :class="{ online: connected }" />LIVE</span></div><div ref="terminal" class="terminal-body" role="log" aria-live="polite"><div v-if="!logs.length" class="terminal-empty">等待构建输出...</div><span v-for="(log, index) in logs" :key="index" :class="log.stream">{{ log.text }}</span></div></section>
</template>
