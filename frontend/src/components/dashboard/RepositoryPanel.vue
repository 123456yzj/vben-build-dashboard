<script setup lang="ts">
import type { Repository } from '../../types/dashboard';

withDefaults(defineProps<{
  repos: Repository[];
  repoSource?: string;
  isLoading: boolean;
}>(), {
  repoSource: '',
});

defineEmits<{
  refresh: [];
  'open-branch': [repo: Repository];
  fetch: [repo: Repository];
  build: [repo: Repository];
}>();
</script>

<template>
  <div class="section-title">
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>📦 业务子包与分支状态 ({{ repos.length }})</span>
      <span
        v-if="repoSource === 'sqlite'"
        class="badge badge-clean"
        style="font-size: 11px; padding: 1px 6px;"
      >
        ⚡ SQLite 秒开
      </span>
    </div>
    <button
      class="btn btn-default btn-sm"
      :disabled="isLoading"
      title="穿透数据库执行底层全量物理扫描（仅在必要时校准）"
      @click="$emit('refresh')"
    >
      <span :class="{ spinning: isLoading }">🔄</span>
      <span>{{ isLoading ? '正在扫描...' : '底层物理重扫' }}</span>
    </button>
  </div>

  <div
    v-if="isLoading && repos.length === 0"
    style="padding: 40px; text-align: center; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--radius-md); color: var(--text-muted); margin-bottom: 20px;"
  >
    <div class="spinning" style="display: inline-block; font-size: 26px; margin-bottom: 10px;">⏳</div>
    <div style="font-size: 14px; font-weight: 600; color: #cbd5e1;">正在从底层 Git 扫描各子包及分支...</div>
    <div style="font-size: 12px; margin-top: 6px; color: #64748b;">扫描完成后将自动持久化写入 SQLite 数据库，后续刷新即可 0 毫秒秒开</div>
  </div>

  <div v-else class="repo-grid">
    <div v-for="repo in repos" :key="repo.path" class="repo-card repo-card-compact">
      <div class="repo-compact-name">
        <span class="repo-module-icon">▣</span>
        <span class="repo-name">{{ repo.name }}</span>
      </div>

      <div class="repo-compact-actions">
        <button class="compact-action branch-action" title="切换分支" @click="$emit('open-branch', repo)">
          <span class="compact-action-icon">⑂</span>
          <span class="branch-pill-name">{{ repo.currentBranch }}</span>
        </button>
        <button class="compact-action icon-action" title="刷新远程分支" aria-label="刷新远程分支" @click="$emit('fetch', repo)">
          ↻
        </button>
        <button
          v-if="!repo.isRoot"
          class="compact-action icon-action"
          title="开发环境打包"
          aria-label="开发环境打包"
          @click="$emit('build', repo)"
        >
          ▶
        </button>
      </div>
    </div>
  </div>
</template>
