<script setup lang="ts">
import { ArrowRight, Download, FolderGit2, GitBranch, GitCommitHorizontal, Play, RefreshCw } from 'lucide-vue-next';
import type { Project, ProjectAction } from '../types/project';

defineProps<{ project: Project; working: boolean; loading: boolean; branch?: string }>();
const emit = defineEmits<{
  navigate: [name: string];
  refresh: [];
  action: [name: string, kind: ProjectAction, branch?: string];
  'update:branch': [name: string, branch: string];
}>();
</script>

<template>
  <article class="project-row">
    <button class="project-main" @click="emit('navigate', project.name)"><span class="project-icon"><FolderGit2 :size="20" /></span><span class="project-identity"><strong>{{ project.name }}</strong><small :title="project.path">{{ project.path }}</small></span><ArrowRight :size="17" class="project-arrow" /></button>
    <div class="project-meta"><span class="branch-label"><GitBranch :size="14" />{{ project.git?.branch || '不可用' }}</span><span class="commit-label" :title="project.git?.message"><GitCommitHorizontal :size="14" />{{ project.git?.hash || '—' }} <span>{{ project.git?.message }}</span></span></div>
    <div class="project-end"><span v-if="project.error" class="state danger" :title="project.error">读取失败</span><span v-else class="state" :class="project.git?.clean ? 'good' : 'warn'">{{ project.git?.clean ? '工作区干净' : '有本地改动' }}</span><span class="build-indicator" :class="project.latestBuild?.status || ''">{{ project.latestBuild?.status || '无构建记录' }}</span><button class="icon-button" title="查看详情" :aria-label="`查看 ${project.name}`" @click="emit('navigate', project.name)"><ArrowRight :size="17" /></button></div>
    <div class="project-actions"><button class="button secondary" :disabled="working || loading" @click="emit('refresh')"><RefreshCw :size="14" />刷新</button><select :value="branch" :aria-label="`${project.name} 分支`" :disabled="working || !project.git" @change="emit('update:branch', project.name, ($event.target as HTMLSelectElement).value)"><option value="" disabled>选择分支</option><option v-for="name in [...new Set([...(project.git?.localBranches || []), ...(project.git?.remoteBranches || [])])]" :key="name" :value="name">{{ name }}</option></select><button class="button secondary" :disabled="working || !branch || branch === project.git?.branch" @click="emit('action', project.name, 'checkout', branch)"><GitBranch :size="14" />切换</button><button class="button secondary" :disabled="working || !project.git" @click="emit('action', project.name, 'pull')"><Download :size="14" />Pull</button><button class="button primary" :disabled="working || !project.git || project.latestBuild?.status === 'running'" @click="emit('action', project.name, 'build')"><Play :size="14" fill="currentColor" />Build</button></div>
  </article>
</template>
