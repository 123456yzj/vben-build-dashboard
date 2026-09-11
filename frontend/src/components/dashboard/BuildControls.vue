<script setup lang="ts">
import type { Repository } from '../../types/dashboard';

defineProps<{
  businessRepos: Repository[];
  selectedPackages: string[];
  isRunning: boolean;
}>();

defineEmits<{
  start: [];
  abort: [];
  'toggle-package': [packageName: string];
}>();
</script>

<template>
  <div class="control-card">
    <div class="control-title">
      <span>🚀 快速打包构建</span>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-primary" :disabled="isRunning" @click="$emit('start')">
          <span>▶</span> {{ isRunning ? '正在打包...' : '开始构建' }}
        </button>
        <button v-if="isRunning" class="btn btn-danger" @click="$emit('abort')">
          <span>⏹</span> 中止任务
        </button>
      </div>
    </div>

    <div class="control-row" style="margin-bottom: 12px;">
      <span style="font-size: 13px; color: var(--text-muted);">打包范围:</span>
      <button
        class="btn btn-sm"
        :class="selectedPackages.includes('all') ? 'btn-primary' : 'btn-default'"
        @click="$emit('toggle-package', 'all')"
      >
        全量打包 (All)
      </button>
      <button
        v-for="repo in businessRepos"
        :key="repo.name"
        class="btn btn-sm"
        :class="selectedPackages.includes(repo.packageName) ? 'btn-primary' : 'btn-default'"
        @click="$emit('toggle-package', repo.packageName)"
      >
        {{ repo.packageName }}
      </button>
    </div>
  </div>
</template>
