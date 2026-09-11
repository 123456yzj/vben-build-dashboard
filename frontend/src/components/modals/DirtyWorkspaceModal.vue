<script setup lang="ts">
import type { DirtyModalState } from '../../types/dashboard';

defineProps<{
  modal: DirtyModalState;
}>();

defineEmits<{
  close: [];
  stash: [];
  reset: [];
}>();
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title" style="color: #f59e0b;">⚠️ 检测到未提交的改动</h3>
        <button class="btn btn-default btn-sm" @click="$emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 12px;">
          仓库 <strong>{{ modal.repo?.name }}</strong> 存在未提交的代码修改，直接切换分支可能导致改动丢失或冲突：
        </p>
        <div style="background: #111827; padding: 10px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 12px; max-height: 180px; overflow-y: auto; color: #cbd5e1;">
          <div v-for="file in modal.repo?.dirtyFiles" :key="file">{{ file }}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" @click="$emit('stash')">暂存并切换 (Git Stash)</button>
        <button class="btn btn-danger" @click="$emit('reset')">强行放弃改动并切换</button>
        <button class="btn btn-default" @click="$emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
