<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Download, FolderGit2, GitBranch, Play, RefreshCw, Terminal } from 'lucide-vue-next';
import { getBuild, getBuilds, getRepositories, getWorkspace, getWorkspaces, gitAction, startBuild } from './api/workspace';
import { useWebSocket, type SocketMessage } from './composables/useWebSocket';
import type { GitAction } from './types/git';
import type { BuildTask } from './types/build';
import type { Repository, TaskDetail, Workspace, WorkspaceDetail } from './types/workspace';

function fromPath(): string | null {
  const match = location.pathname.match(/^\/workspaces\/([^/]+)$/);
  try { return match ? decodeURIComponent(match[1]!) : null; } catch { return null; }
}
const selected = ref<string | null>(fromPath());
const workspaces = ref<Workspace[]>([]);
const workspace = ref<WorkspaceDetail | null>(null);
const repositories = ref<Repository[]>([]);
const builds = ref<BuildTask[]>([]);
const active = ref<TaskDetail | null>(null);
const chosen = ref<string[]>([]);
const branches = ref<Record<string, string>>({});
const error = ref('');
const loading = ref(false);
const working = ref(false);
const eligible = computed(() => repositories.value.filter((repo) => repo.git?.clean && repo.buildable && !repo.busy));
const canBuild = computed(() => !working.value && !workspace.value?.busy && !repositories.value.some((repo) => repo.busy));

async function loadList() {
  try { workspaces.value = await getWorkspaces(); error.value = ''; }
  catch (cause) { error.value = (cause as Error).message; }
}
async function loadWorkspace(refresh = false) {
  if (!selected.value) return;
  const name = selected.value;
  loading.value = true;
  try {
    const [detail, repos, history] = await Promise.all([getWorkspace(name), getRepositories(name, refresh), getBuilds(name)]);
    if (selected.value !== name) return;
    workspace.value = detail;
    repositories.value = repos;
    builds.value = history;
    chosen.value = chosen.value.filter((item) => repos.some((repo) => repo.name === item));
    for (const repo of repos) if (!branches.value[repo.name]) branches.value[repo.name] = repo.git?.branch || '';
    if (active.value) active.value = await getBuild(name, active.value.id);
    error.value = '';
  } catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
}
function navigate(name: string | null) {
  selected.value = name;
  workspace.value = null;
  repositories.value = [];
  builds.value = [];
  active.value = null;
  chosen.value = [];
  history.pushState({}, '', name ? `/workspaces/${encodeURIComponent(name)}` : '/');
  if (name) void loadWorkspace(); else void loadList();
}
function onPopState() {
  const name = fromPath();
  selected.value = name;
  workspace.value = null;
  repositories.value = [];
  builds.value = [];
  active.value = null;
  chosen.value = [];
  if (name) void loadWorkspace(); else void loadList();
}
function toggle(name: string) {
  chosen.value = chosen.value.includes(name) ? chosen.value.filter((item) => item !== name) : [...chosen.value, name];
}
async function operate(repo: Repository, action: GitAction) {
  if (!selected.value) return;
  working.value = true;
  try {
    await gitAction(selected.value, repo.name, action, action === 'checkout' ? branches.value[repo.name] : undefined);
    await loadWorkspace(true);
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}
async function build(scope: 'all' | 'repositories') {
  if (!selected.value) return;
  working.value = true;
  try {
    const task = await startBuild(selected.value, scope === 'all' ? { scope } : { scope, repositories: chosen.value });
    builds.value.unshift(task);
    active.value = { ...task, logs: [] };
    await loadWorkspace();
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}
async function showTask(task: BuildTask) {
  if (!selected.value) return;
  try { active.value = await getBuild(selected.value, task.id); }
  catch (cause) { error.value = (cause as Error).message; }
}
function applyMessage(message: SocketMessage) {
  if (message.workspace !== selected.value) return;
  if (message.type === 'git' && message.repository && message.git) {
    const repo = repositories.value.find((item) => item.name === message.repository);
    if (repo) { repo.git = message.git; branches.value[repo.name] = message.git.branch; }
  }
  if (message.type === 'busy') {
    if (message.repository) {
      const repo = repositories.value.find((item) => item.name === message.repository);
      if (repo) repo.busy = !!message.busy;
    } else if (workspace.value) workspace.value.busy = !!message.busy;
  }
  if (message.type === 'build' && message.task) {
    const index = builds.value.findIndex((item) => item.id === message.task?.id);
    if (index >= 0) builds.value[index] = message.task; else builds.value.unshift(message.task);
    if (active.value?.id === message.task.id) active.value = { ...message.task, logs: active.value.logs };
  }
  if (message.type === 'log' && active.value && active.value.id === message.buildId && message.text) {
    const task = active.value;
    task.logs.push({ stream: message.stream || 'stdout', text: message.text, buildId: message.buildId! });
    if (task.logs.length > 2000) task.logs.splice(0, task.logs.length - 2000);
  }
}
const { connected, connect, disconnect } = useWebSocket(applyMessage, () => {
  void loadList();
  if (selected.value) void loadWorkspace(true);
});
onMounted(() => { void loadList(); if (selected.value) void loadWorkspace(); connect(); window.addEventListener('popstate', onPopState); });
onUnmounted(() => { disconnect(); window.removeEventListener('popstate', onPopState); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar"><button class="brand" title="工作区列表" @click="navigate(null)"><span class="brand-mark"><Terminal :size="19" /></span>VBEN <strong>WORKSPACE</strong></button><span class="connection" :class="{ online: connected }"><span class="dot" />{{ connected ? 'AGENT ONLINE' : 'AGENT OFFLINE' }}</span></header>
    <main class="workspace">
      <div v-if="error" class="alert"><CircleAlert :size="17" />{{ error }}<button aria-label="关闭错误" @click="error = ''">×</button></div>
      <template v-if="!selected">
        <div class="page-heading"><div><div class="eyebrow">WORKSPACES</div><h1>工作区</h1></div><button class="button secondary" @click="loadList"><RefreshCw :size="15" />刷新</button></div>
        <div class="section-heading">Vben 主工程 <span class="count">{{ workspaces.length }}</span></div>
        <div v-if="!workspaces.length" class="empty">暂无工作区，请配置 config/workspaces.json。</div>
        <button v-for="item in workspaces" :key="item.name" class="workspace-row" @click="navigate(item.name)"><FolderGit2 :size="22" /><span><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span><ArrowRight :size="17" /></button>
      </template>
      <template v-else>
        <button class="back-link" @click="navigate(null)"><ArrowLeft :size="16" />工作区</button>
        <div class="page-heading"><div><div class="eyebrow">WORKSPACE / {{ selected }}</div><h1>{{ selected }}</h1><p>{{ workspace?.path }}</p></div><button class="button secondary" :disabled="loading" @click="loadWorkspace(true)"><RefreshCw :size="15" :class="{ spin: loading }" />重新扫描</button></div>
        <div class="section-heading">业务仓库 <span class="count">{{ repositories.length }}</span></div>
        <div v-if="!repositories.length && !loading" class="empty">扫描目录中没有发现 Git 仓库。</div>
        <div class="repository-list">
          <div v-for="repo in repositories" :key="repo.name" class="repository-row">
            <label class="repository-identity"><input type="checkbox" :checked="chosen.includes(repo.name)" :disabled="!eligible.some((item) => item.name === repo.name) || !canBuild" @change="toggle(repo.name)" /><FolderGit2 :size="19" /><span><strong>{{ repo.name }}</strong><small :title="repo.path">{{ repo.path }}</small></span></label>
            <div class="repository-status"><span><GitBranch :size="14" />{{ repo.git?.branch || '不可用' }}</span><span :class="repo.error ? 'text-error' : repo.git?.clean ? 'text-good' : 'text-warn'">{{ repo.error ? '读取失败' : repo.git?.clean ? 'clean' : 'dirty' }}</span><small v-if="repo.error" :title="repo.error">{{ repo.error }}</small><small v-else :title="repo.buildScript ? `主工程: pnpm run ${repo.buildScript}` : '主工程无匹配的 dev 构建脚本'">{{ repo.buildScript || '无 dev 构建脚本' }}</small></div>
            <div class="repository-actions"><select v-model="branches[repo.name]" :aria-label="`${repo.name} 分支`" :disabled="working || repo.busy || !repo.git"><option v-for="branch in [...new Set([...(repo.git?.localBranches || []), ...(repo.git?.remoteBranches || [])])]" :key="branch" :value="branch">{{ branch }}</option></select><button class="button secondary" title="切换分支" :disabled="working || repo.busy || !repo.git?.clean || !branches[repo.name] || branches[repo.name] === repo.git?.branch" @click="operate(repo, 'checkout')"><GitBranch :size="15" />切换</button><button class="button secondary" title="拉取更新" :disabled="working || repo.busy || !repo.git?.clean" @click="operate(repo, 'pull')"><Download :size="15" />Pull</button><button class="icon-button" title="获取远程分支" :aria-label="`Fetch ${repo.name}`" :disabled="working || repo.busy || !repo.git" @click="operate(repo, 'fetch')"><RefreshCw :size="15" /></button></div>
          </div>
        </div>
        <div class="build-controls"><span>{{ chosen.length }} 项已选</span><button class="button secondary" :disabled="!canBuild || !workspace?.build.all || !repositories.length || repositories.some((repo) => !repo.git?.clean)" @click="build('all')"><Play :size="15" />全部 dev 构建</button><button class="button primary" :disabled="!canBuild || !chosen.length" @click="build('repositories')"><Check :size="15" />构建选中业务</button></div>
        <template v-if="active"><div class="section-heading">构建输出 <span class="count">{{ active.status }}</span></div><div class="task-summary">{{ active.scope === 'all' ? '全部业务' : active.repositories.join(' → ') }}<span v-for="step in active.steps" :key="step.repository || 'all'">{{ step.repository || '全部' }} · {{ step.branch }} · {{ step.status }}</span></div><div class="terminal-body" role="log" aria-live="polite"><span v-for="(log, index) in active.logs" :key="index" :class="log.stream">{{ log.text }}</span><span v-if="!active.logs.length" class="terminal-empty">暂无输出</span></div></template>
        <div class="section-heading history-heading">构建历史 <span class="count">{{ builds.length }}</span></div><div v-if="!builds.length" class="empty">暂无构建记录</div><button v-for="task in builds" :key="task.id" class="history-row" :class="{ selected: active?.id === task.id }" @click="showTask(task)"><span :class="`status-${task.status}`">{{ task.status }}</span><strong>{{ task.scope === 'all' ? '全部业务' : task.repositories.join(', ') }}</strong><time>{{ new Date(task.time).toLocaleString() }}</time><span>{{ task.duration === null ? '—' : `${(task.duration / 1000).toFixed(1)}s` }}</span></button>
      </template>
    </main><footer class="footer">VBEN WORKSPACE <span>{{ connected ? 'CONNECTED' : 'DISCONNECTED' }}</span></footer>
  </div>
</template>
