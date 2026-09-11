<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import type { BranchItem, BranchPickerState, BranchTab } from '../../types/dashboard';

defineProps<{
  picker: BranchPickerState;
  branches: BranchItem[];
  localCount: number;
  remoteCount: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [branch: BranchItem];
  'update:search': [search: string];
  'update:tab': [tab: BranchTab];
}>();

const searchInput = ref<HTMLInputElement | null>(null);

const handleSearchInput = (event: Event) => {
  emit('update:search', (event.target as HTMLInputElement).value);
};

onMounted(() => {
  nextTick(() => searchInput.value?.focus());
});
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content branch-picker-modal">
      <div class="modal-header" style="border-bottom: none; padding-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">🌿</span>
          <div>
            <h3 class="modal-title" style="font-size: 16px;">选择分支以检出 (Checkout)</h3>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              仓库: <strong style="color: #38bdf8;">{{ picker.repo?.name }}</strong>
              <span style="margin: 0 6px;">·</span>
              当前检出: <span style="color: #34d399; font-weight: 600;">{{ picker.repo?.currentBranch }}</span>
            </div>
          </div>
        </div>
        <button class="btn btn-default btn-sm" @click="$emit('close')">✕</button>
      </div>

      <div class="branch-picker-body">
        <div class="branch-search-box">
          <span class="search-icon">🔍</span>
          <input
            ref="searchInput"
            :value="picker.search"
            type="text"
            placeholder="输入分支名称快速过滤..."
            class="branch-quick-input"
            @input="handleSearchInput"
            @keydown.esc="$emit('close')"
          >
          <button v-if="picker.search" class="clear-search-btn" @click="$emit('update:search', '')">✕</button>
        </div>

        <div class="branch-type-tabs">
          <button class="branch-tab" :class="{ active: picker.tab === 'all' }" @click="$emit('update:tab', 'all')">
            全部 ({{ branches.length }})
          </button>
          <button class="branch-tab" :class="{ active: picker.tab === 'local' }" @click="$emit('update:tab', 'local')">
            🌿 本地分支 ({{ localCount }})
          </button>
          <button class="branch-tab" :class="{ active: picker.tab === 'remote' }" @click="$emit('update:tab', 'remote')">
            🌐 远程分支 ({{ remoteCount }})
          </button>
        </div>

        <div class="branch-picker-list">
          <div v-if="branches.length === 0" class="branch-picker-empty">没有匹配的分支</div>
          <div
            v-for="item in branches"
            v-else
            :key="item.key"
            class="branch-picker-item"
            :class="{ 'is-current': item.isCurrent }"
            @click="$emit('select', item)"
          >
            <div class="branch-item-left">
              <span class="branch-kind-icon">{{ item.isRemote ? '🌐' : '🌿' }}</span>
              <div class="branch-name-wrap">
                <span class="branch-item-name">{{ item.name }}</span>
                <span v-if="item.isRemote" class="branch-remote-tag">origin</span>
              </div>
            </div>

            <div class="branch-item-right">
              <span
                v-if="item.isCurrent"
                class="badge badge-branch"
                style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.4);"
              >
                ✔ 当前检出
              </span>
              <span v-else class="switch-hint">点击切换 ↵</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer" style="padding-top: 10px; margin-bottom: 0; font-size: 11.5px; color: var(--text-muted); justify-content: space-between; align-items: center;">
        <span>提示：支持输入关键字搜索；点击远程分支将自动创建并跟踪同名本地分支</span>
        <button class="btn btn-default btn-sm" @click="$emit('close')">关闭 (Esc)</button>
      </div>
    </div>
  </div>
</template>
