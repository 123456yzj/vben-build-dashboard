<script setup lang="ts">
import type { BuildStatus } from '../../types/dashboard';

defineProps<{
  buildStatus: BuildStatus;
  buildStatusText: string;
}>();
</script>

<template>
  <div class="stats-bar">
    <div class="stat-item">
      <span class="stat-label">构建环境:</span>
      <span class="stat-value">development</span>
    </div>

    <div class="stat-item">
      <span class="stat-label">构建状态:</span>
      <span
        class="badge"
        :class="{
          'badge-clean': buildStatus.status === 'success',
          'badge-dirty': buildStatus.status === 'running',
          'badge-branch': buildStatus.status === 'idle',
        }"
      >
        {{ buildStatusText }}
      </span>
    </div>
  </div>
</template>
