<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next';
import ProjectItem from './ProjectItem.vue';
import type { Project, ProjectAction } from '../types/project';

defineProps<{ projects: Project[]; loading: boolean; working: boolean; listBranches: Record<string, string> }>();
const emit = defineEmits<{
  navigate: [name: string];
  refresh: [];
  action: [name: string, kind: ProjectAction, branch?: string];
  'update:branch': [name: string, branch: string];
}>();
</script>

<template>
  <div class="page-heading"><div><div class="eyebrow">WORKSPACE / PROJECTS</div><h1>项目</h1><p>远程仓库与构建</p></div><button class="button secondary" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="15" :class="{ spin: loading }" />刷新</button></div>
  <div class="section-heading"><span>已配置项目</span><span class="count">{{ projects.length }}</span></div>
  <div v-if="!projects.length && !loading" class="empty">没有配置项目。请在服务器的 config/projects.json 中添加项目。</div>
  <div class="project-list">
    <ProjectItem v-for="project in projects" :key="project.name" :project="project" :branch="listBranches[project.name]" :working="working" :loading="loading" @navigate="emit('navigate', $event)" @refresh="emit('refresh')" @action="(name, kind, branch) => emit('action', name, kind, branch)" @update:branch="(name, branch) => emit('update:branch', name, branch)" />
  </div>
</template>
