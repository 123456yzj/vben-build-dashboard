<script setup lang="ts">
import type { Toast } from '../../types/dashboard';

defineProps<{
  toasts: Toast[];
}>();
</script>

<template>
  <div class="toast-container">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
      {{ toast.message }}
    </div>
  </div>
</template>
