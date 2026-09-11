<script setup lang="ts">
withDefaults(defineProps<{
  targetRepoPath?: string;
}>(), {
  targetRepoPath: '',
});

defineEmits<{
  'open-settings': [];
}>();
</script>

<template>
  <header class="app-header">
    <div class="brand-area">
      <div class="brand-logo">V</div>
      <div>
        <div class="brand-title">Vben Build Dashboard</div>
        <div class="brand-badge">{{ targetRepoPath || '未配置项目路径' }}</div>
      </div>
    </div>

    <div class="header-actions">
      <button class="btn btn-default" @click="$emit('open-settings')">
        <span>🔧</span> 系统设置
      </button>
    </div>
  </header>
</template>
