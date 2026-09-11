<script setup lang="ts">
import type { AppConfig, DirectoryPickerState, FieldErrors } from '../../types/dashboard';

defineProps<{
  config: AppConfig;
  directoryPicker: DirectoryPickerState;
  fieldErrors: FieldErrors;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  'browse-directory': [path?: string | null];
  close: [];
  save: [];
  'select-directory': [];
  'toggle-directory-picker': [];
  'update-protected-branches': [branches: string];
}>();

const handleProtectedBranchesInput = (event: Event) => {
  emit('update-protected-branches', (event.target as HTMLInputElement).value);
};
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-content" style="max-width: 680px;">
      <div class="modal-header">
        <h3 class="modal-title">🔧 系统持久化设置</h3>
        <button class="btn btn-default btn-sm" @click="$emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom: 16px;">
          <label for="target-repo-path" style="display: block; font-weight: 600; margin-bottom: 6px;">
            目标 Monorepo 根路径:
          </label>
          <div class="directory-select">
            <button
              id="target-repo-path"
              type="button"
              class="directory-select-trigger"
              :class="{ 'input-error': fieldErrors.targetRepoPath }"
              :aria-label="`目标 Monorepo 根路径: ${config.targetRepoPath || '未选择'}`"
              :aria-expanded="directoryPicker.show"
              @click="$emit('toggle-directory-picker')"
            >
              <span class="directory-selected-path">{{ config.targetRepoPath || '请选择 Monorepo 根目录' }}</span>
              <span class="directory-caret" aria-hidden="true">{{ directoryPicker.show ? '▴' : '▾' }}</span>
            </button>

            <div v-if="directoryPicker.show" class="directory-dropdown">
              <div class="directory-toolbar">
                <button
                  type="button"
                  class="btn btn-default btn-sm"
                  :disabled="directoryPicker.parentPath === null || directoryPicker.loading"
                  @click="$emit('browse-directory', directoryPicker.parentPath)"
                >
                  ← 上一级
                </button>
                <button
                  type="button"
                  class="compact-action icon-action"
                  :disabled="directoryPicker.loading"
                  title="刷新当前目录"
                  aria-label="刷新当前目录"
                  @click="$emit('browse-directory', directoryPicker.currentPath)"
                >
                  ↻
                </button>
              </div>

              <div class="directory-current-path" :title="directoryPicker.currentPath">
                {{ directoryPicker.currentPath || '选择磁盘' }}
              </div>

              <div class="directory-list" :aria-busy="directoryPicker.loading">
                <div v-if="directoryPicker.loading" class="directory-state">正在读取目录...</div>
                <div v-else-if="directoryPicker.error" class="directory-state directory-error">{{ directoryPicker.error }}</div>
                <div v-else-if="directoryPicker.directories.length === 0" class="directory-state">当前目录没有子目录</div>
                <button
                  v-for="directory in directoryPicker.directories"
                  v-else
                  :key="directory.path"
                  type="button"
                  class="directory-item"
                  @click="$emit('browse-directory', directory.path)"
                >
                  <span class="directory-folder" aria-hidden="true">▰</span>
                  <span>{{ directory.name }}</span>
                  <span class="directory-enter" aria-hidden="true">›</span>
                </button>
              </div>

              <div class="directory-footer">
                <span :class="directoryPicker.isProject ? 'directory-valid' : 'directory-hint'">
                  {{ directoryPicker.isProject ? '可用的项目目录' : '请选择包含 package.json 或 .git 的目录' }}
                </span>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="!directoryPicker.isProject || directoryPicker.loading"
                  @click="$emit('select-directory')"
                >
                  选择此目录
                </button>
              </div>
            </div>
          </div>
          <div v-if="fieldErrors.targetRepoPath" class="field-feedback">⚠️ {{ fieldErrors.targetRepoPath }}</div>
        </div>

        <div style="margin-bottom: 16px;">
          <label for="protected-branches" style="display: block; font-weight: 600; margin-bottom: 6px;">
            受保护分支白名单 (逗号分隔):
          </label>
          <input
            id="protected-branches"
            type="text"
            name="protectedBranches"
            :value="config.protectedBranches?.join(', ')"
            :class="{ 'input-error': fieldErrors.protectedBranches }"
            placeholder="master, main, develop, test"
            style="width: 100%;"
            @input="handleProtectedBranchesInput"
          >
          <div v-if="fieldErrors.protectedBranches" class="field-feedback">⚠️ {{ fieldErrors.protectedBranches }}</div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-primary" :disabled="isSaving" @click="$emit('save')">
          {{ isSaving ? '正在保存...' : '保存配置' }}
        </button>
        <button class="btn btn-default" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>
