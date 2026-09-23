<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft, Download, GitBranch, Play, RefreshCw, Terminal } from 'lucide-vue-next';
import BuildHistory from './BuildHistory.vue';
import TerminalPanel from './TerminalPanel.vue';
import type { Project, ProjectAction, ProjectDetail as Detail } from '../types/project';

const props = defineProps<{ selected: string; detail: Detail | null; current?: Project; branch: string; working: boolean; connected: boolean }>();
const emit = defineEmits<{
  back: [];
  refresh: [];
  'update:branch': [branch: string];
  action: [name: string, kind: ProjectAction, branch?: string];
}>();
const branches = computed(() => props.detail?.git ? [...new Set([...props.detail.git.localBranches, ...props.detail.git.remoteBranches])] : []);
</script>

<template>
  <button class="back-link" @click="emit('back')"><ArrowLeft :size="16" />所有项目</button>
  <div class="page-heading detail-heading"><div><div class="eyebrow">WORKSPACE / {{ selected.toUpperCase() }}</div><h1>{{ selected }}</h1><p>{{ detail?.path || current?.path }}</p></div><button class="button secondary" @click="emit('refresh')"><RefreshCw :size="15" />刷新</button></div>
  <template v-if="detail">
    <div class="detail-grid">
      <section class="git-section"><div class="section-heading"><span>GIT 状态</span><GitBranch :size="16" /></div><div class="info-line"><span>当前分支</span><strong>{{ detail.git?.branch }}</strong></div><div class="info-line"><span>最新提交</span><strong class="mono">{{ detail.git?.hash }}</strong></div><div class="info-line"><span>提交信息</span><strong class="message">{{ detail.git?.message }}</strong></div><div class="info-line"><span>工作区</span><strong :class="detail.git?.clean ? 'text-good' : 'text-warn'">{{ detail.git?.clean ? '干净' : '有本地改动' }}</strong></div><div class="action-group"><button class="button secondary" :disabled="working || detail.busy" @click="emit('action', detail.name, 'fetch')"><RefreshCw :size="15" />Fetch</button><button class="button secondary" :disabled="working || detail.busy" @click="emit('action', detail.name, 'pull')"><Download :size="15" />Pull</button></div></section>
      <section class="control-section"><div class="section-heading"><span>操作</span><Terminal :size="16" /></div><label for="branch">切换分支</label><div class="branch-control"><select id="branch" :value="branch" :disabled="working || detail.busy" @change="emit('update:branch', ($event.target as HTMLSelectElement).value)"><option v-for="name in branches" :key="name" :value="name">{{ name }}</option></select><button class="button secondary" :disabled="working || detail.busy || !branch || branch === detail.git?.branch" @click="emit('action', detail.name, 'checkout', branch)">切换</button></div><div class="control-divider" /><label>构建命令</label><div class="command">{{ detail.buildCommand }}</div><button class="button primary" :disabled="working || detail.busy" @click="emit('action', detail.name, 'build')"><Play :size="15" fill="currentColor" />开始构建</button></section>
    </div>
    <TerminalPanel :logs="detail.logs" :latest-build="detail.latestBuild" :connected="connected" />
    <BuildHistory :history="detail.history" />
  </template>
</template>
