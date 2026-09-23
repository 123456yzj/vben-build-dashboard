<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, CircleAlert, Clock3, Copy, GitBranch, Play, RefreshCw, Search, Settings2, Square, Terminal, X } from 'lucide-vue-next';
import { cancelBuild, getBuild, getBuilds, getRepositories, getWorkspace, getWorkspaces, gitAction, startBuild } from './api/workspace';
import { useWebSocket, type SocketMessage } from './composables/useWebSocket';
import type { BuildTask } from './types/build';
import type { BuildLog, Repository, TaskDetail, Workspace, WorkspaceDetail } from './types/workspace';

const workspaces = ref<Workspace[]>([]);
const selected = ref<string | null>(null);
const workspace = ref<WorkspaceDetail | null>(null);
const repositories = ref<Repository[]>([]);
const builds = ref<BuildTask[]>([]);
const active = ref<TaskDetail | null>(null);
const chosen = ref<string[]>([]);
const loading = ref(false);
const working = ref(false);
const cancelling = ref<string | null>(null);
const error = ref('');
const dialog = ref<'settings' | 'branch' | null>(null);
const branchRepo = ref<Repository | null>(null);
const branchTarget = ref('');
const branchQuery = ref('');
const drawerOpen = ref(false);
const historyOpen = ref(false);
const logTab = ref('summary');
const followStep = ref(true);
const followOutput = ref(true);
const logBody = ref<HTMLElement | null>(null);
const logPositions = new Map<string, number>();
const visibleBuilds = computed(() => historyOpen.value ? builds.value : builds.value.slice(0, 5));
const running = computed(() => active.value?.status === 'pending' || active.value?.status === 'running');
const eligible = (repo: Repository) => !!repo.git?.clean && repo.buildable && !repo.busy;
const canBuild = computed(() => !working.value && !workspace.value?.busy && !repositories.value.some((repo) => repo.busy));
const selectedReady = computed(() => chosen.value.every((name) => {
  const repo = repositories.value.find((item) => item.name === name);
  return !!repo && eligible(repo);
}));
const allReady = computed(() => !!workspace.value?.build.all && repositories.value.length > 0 && repositories.value.every((repo) => !!repo.git?.clean && !repo.busy));
const currentStep = computed(() => active.value?.steps.find((step) => step.status === 'running'));
const visibleLogs = computed(() => (active.value?.logs || []).filter((log) => logTab.value === 'summary' || (logTab.value === 'all' ? log.repository === null : log.repository === logTab.value)));
const selectedStep = computed(() => active.value?.steps.find((step) => step.repository === logTab.value));
const branchOptions = computed(() => [...new Set([...(branchRepo.value?.git?.localBranches || []), ...(branchRepo.value?.git?.remoteBranches || [])])].filter((name) => name.toLowerCase().includes(branchQuery.value.toLowerCase())));

function statusLabel(status: string) { return ({ pending: '等待中', running: '构建中', success: '成功', failed: '失败', cancelled: '已终止' } as Record<string, string>)[status] || status; }
function taskLabel(task: BuildTask) { return task.scope === 'all' ? '全量 Dev 构建' : task.repositories.join('、'); }
function duration(ms: number | null) { return ms === null ? '—' : `${(ms / 1000).toFixed(1)} 秒`; }
function labelFor(repo: Repository) {
  if (repo.error) return repo.error;
  if (!repo.git) return '无法读取仓库状态';
  if (!repo.git.clean) return '有未提交改动，无法构建';
  if (!repo.buildable) return '主工程没有对应的 Dev 构建脚本';
  if (repo.busy) return '业务正在执行其他操作';
  return '';
}

async function loadList() {
  try {
    workspaces.value = await getWorkspaces();
    const fromUrl = location.pathname.match(/^\/workspaces\/([^/]+)$/);
    let name: string | undefined;
    try { name = fromUrl ? decodeURIComponent(fromUrl[1]!) : undefined; } catch { name = undefined; }
    selected.value = workspaces.value.find((item) => item.name === selected.value)?.name || workspaces.value.find((item) => item.name === name)?.name || workspaces.value[0]?.name || null;
    if (selected.value) await loadWorkspace();
  } catch (cause) { error.value = (cause as Error).message; }
}
async function loadWorkspace(refresh = false) {
  if (!selected.value) return;
  const name = selected.value;
  loading.value = true;
  try {
    const [detail, repos, history] = await Promise.all([getWorkspace(name), getRepositories(name, refresh), getBuilds(name)]);
    if (name !== selected.value) return;
    workspace.value = detail;
    repositories.value = repos;
    builds.value = history;
    chosen.value = chosen.value.filter((item) => repos.some((repo) => repo.name === item));
    const task = active.value || history.find((item) => item.status === 'running' || item.status === 'pending');
    if (task) await refreshTask(task.id);
    error.value = '';
  } catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
}
async function refreshTask(id: string) {
  if (!selected.value) return;
  const detail = await getBuild(selected.value, id);
  if (!active.value || active.value.id === id) active.value = detail;
}
function chooseWorkspace(name: string) {
  if (name === selected.value) return;
  selected.value = name;
  workspace.value = null;
  repositories.value = [];
  builds.value = [];
  active.value = null;
  chosen.value = [];
  history.replaceState({}, '', `/workspaces/${encodeURIComponent(name)}`);
  void loadWorkspace();
}
function toggle(name: string) { chosen.value = chosen.value.includes(name) ? chosen.value.filter((item) => item !== name) : [...chosen.value, name]; }
async function build(scope: 'all' | 'repositories', names = chosen.value) {
  if (!selected.value || !canBuild.value || (scope === 'repositories' && (!names.length || !names.every((name) => {
    const repo = repositories.value.find((item) => item.name === name);
    return !!repo && eligible(repo);
  }))) || (scope === 'all' && !allReady.value)) return;
  working.value = true;
  try {
    const task = await startBuild(selected.value, scope === 'all' ? { scope } : { scope, repositories: names });
    builds.value = [task, ...builds.value.filter((item) => item.id !== task.id)];
    active.value = { ...task, logs: [] };
    logTab.value = 'summary';
    followStep.value = true;
    drawerOpen.value = false;
    await loadWorkspace();
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}
function openBranch(repo: Repository) {
  branchRepo.value = repo;
  branchTarget.value = '';
  branchQuery.value = '';
  dialog.value = 'branch';
}
async function switchBranch() {
  if (!selected.value || !branchRepo.value || !branchTarget.value || branchTarget.value === branchRepo.value.git?.branch) return;
  working.value = true;
  try {
    await gitAction(selected.value, branchRepo.value.name, 'checkout', branchTarget.value);
    dialog.value = null;
    await loadWorkspace(true);
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}
async function fetchBranches() {
  if (!selected.value || !branchRepo.value) return;
  working.value = true;
  try {
    const result = await gitAction(selected.value, branchRepo.value.name, 'fetch');
    branchRepo.value.git = result.git;
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}
async function showTask(task: BuildTask) {
  if (!selected.value) return;
  try {
    active.value = await getBuild(selected.value, task.id);
    logTab.value = 'summary';
    followStep.value = false;
    drawerOpen.value = true;
  } catch (cause) { error.value = (cause as Error).message; }
}
async function cancelTask(task: BuildTask) {
  if (!selected.value || cancelling.value || (task.status !== 'running' && task.status !== 'pending')) return;
  cancelling.value = task.id;
  try {
    const finished = await cancelBuild(selected.value, task.id);
    const index = builds.value.findIndex((item) => item.id === finished.id);
    if (index >= 0) builds.value[index] = finished;
    if (active.value?.id === finished.id) active.value = { ...finished, logs: active.value.logs };
    await loadWorkspace();
  } catch (cause) { error.value = (cause as Error).message; }
  finally { cancelling.value = null; }
}
function selectLogTab(tab: string) {
  if (logBody.value) logPositions.set(logTab.value, logBody.value.scrollTop);
  logTab.value = tab;
  followStep.value = false;
  followOutput.value = false;
  void nextTick(() => { if (logBody.value) logBody.value.scrollTop = logPositions.get(tab) || 0; });
}
function scrollBottom() {
  followOutput.value = true;
  if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight;
}
function onLogScroll() {
  if (!logBody.value) return;
  followOutput.value = logBody.value.scrollHeight - logBody.value.scrollTop - logBody.value.clientHeight < 32;
  logPositions.set(logTab.value, logBody.value.scrollTop);
}
async function copyLogs() { try { await navigator.clipboard.writeText(visibleLogs.value.map((log) => log.text).join('')); } catch { error.value = '复制日志失败'; } }
function applyMessage(message: SocketMessage) {
  if (message.workspace !== selected.value) return;
  if (message.type === 'git' && message.repository && message.git) {
    const repo = repositories.value.find((item) => item.name === message.repository);
    if (repo) repo.git = message.git;
  }
  if (message.type === 'busy') {
    if (message.repository) { const repo = repositories.value.find((item) => item.name === message.repository); if (repo) repo.busy = !!message.busy; }
    else if (workspace.value) workspace.value.busy = !!message.busy;
  }
  if (message.type === 'build' && message.task) {
    const index = builds.value.findIndex((item) => item.id === message.task?.id);
    if (index >= 0) builds.value[index] = message.task; else builds.value.unshift(message.task);
    if (!active.value && (message.task.status === 'running' || message.task.status === 'pending')) {
      active.value = { ...message.task, logs: [] };
    }
    if (active.value?.id === message.task.id) {
      active.value = { ...message.task, logs: active.value.logs };
      if (followStep.value && drawerOpen.value) logTab.value = message.task.steps.find((step) => step.status === 'running')?.repository || 'summary';
    }
  }
  const task = active.value;
  if (message.type === 'log' && task && task.id === message.buildId && message.text) {
    const log: BuildLog = { stream: message.stream || 'stdout', text: message.text, buildId: message.buildId!, repository: message.repository || null, time: message.time || new Date().toISOString(), sequence: message.sequence || 0 };
    if (!task.logs.some((item) => item.sequence === log.sequence && item.sequence !== 0)) task.logs.push(log);
    if (task.logs.length > 2000) task.logs.splice(0, task.logs.length - 2000);
    if (followOutput.value) void nextTick(scrollBottom);
  }
}
const { connected, connect, disconnect } = useWebSocket(applyMessage, () => { void loadList(); });
watch(drawerOpen, (opened) => {
  if (opened) {
    if (followStep.value) logTab.value = currentStep.value?.repository || (active.value?.scope === 'all' ? 'all' : 'summary');
    void nextTick(scrollBottom);
  }
});
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') { if (dialog.value) dialog.value = null; else drawerOpen.value = false; } }
onMounted(() => { void loadList(); connect(); window.addEventListener('keydown', onKeydown); });
onUnmounted(() => { disconnect(); window.removeEventListener('keydown', onKeydown); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark"><Terminal :size="17" /></span><span>VBEN <strong>DEV BUILD CONSOLE</strong></span></div><span class="connection" :class="{ online: connected }"><span class="dot" />{{ connected ? 'AGENT ONLINE' : 'AGENT OFFLINE · 正在重连' }}</span></header>
    <main class="workspace">
      <div v-if="error" class="alert" role="alert"><CircleAlert :size="17" />{{ error }}<button aria-label="关闭错误" @click="error = ''"><X :size="16" /></button></div>
      <div v-if="!selected" class="empty-state"><Terminal :size="26" /><h1>尚未配置 Vben 主工程</h1><p>请在 config/workspaces.json 中配置工程根目录。</p><button class="button secondary" @click="loadList"><RefreshCw :size="15" />重新加载</button></div>
      <template v-else>
        <section class="project-head"><div class="project-title"><div class="eyebrow">当前工程</div><h1>{{ workspace?.name || selected }}</h1><p :title="workspace?.path">{{ workspace?.path }}</p></div><div class="project-actions"><button class="button secondary" :disabled="loading" @click="loadWorkspace(true)"><RefreshCw :size="15" :class="{ spin: loading }" />重新扫描</button><button class="icon-button" title="项目设置" aria-label="项目设置" @click="dialog = 'settings'"><Settings2 :size="17" /></button></div></section>
        <section class="quick-build" aria-labelledby="build-heading"><div class="quick-top"><div><div class="eyebrow">BUILD / DEV</div><h2 id="build-heading">快速构建</h2><p>选择业务，立即开始构建</p></div><div class="quick-action"><button class="button primary build-button" :disabled="!canBuild || !chosen.length || !selectedReady" @click="build('repositories')"><Play :size="17" fill="currentColor" />{{ working ? '正在启动…' : `构建 Dev${chosen.length ? ` · ${chosen.length}` : ''}` }}</button></div></div>
          <div class="business-choices" role="group" aria-label="选择构建业务"><button v-for="repo in repositories" :key="repo.name" class="business-chip" :class="{ picked: chosen.includes(repo.name) }" :disabled="!eligible(repo) || !canBuild" :title="labelFor(repo) || repo.name" :aria-pressed="chosen.includes(repo.name)" @click="toggle(repo.name)">{{ repo.name }}</button><span v-if="!repositories.length" class="muted">{{ loading ? '正在发现业务…' : '未发现业务仓库，请检查扫描目录。' }}</span></div>
          <div class="build-footer"><span>{{ chosen.length ? `构建顺序：${chosen.join(' → ')}` : '选择一个或多个业务' }}</span><div><button v-if="chosen.length" class="text-button" @click="chosen = []">清空选择</button><button class="text-button" :disabled="!canBuild || !allReady" :title="'执行主工程 pnpm run build:dev'" @click="build('all')">全量 Dev 构建 <span aria-hidden="true">↗</span></button></div></div>
        </section>
        <section class="business-section"><div class="section-title"><div><div class="eyebrow">REPOSITORIES</div><h2>业务分支 <span class="count">{{ repositories.length }}</span></h2></div></div><div class="branch-list"><div v-for="repo in repositories" :key="repo.name" class="branch-row"><strong>{{ repo.name }}</strong><span class="branch-name" :title="repo.git?.branch || repo.error || '分支不可用'"><GitBranch :size="15" />{{ repo.git?.branch || '分支不可用' }}</span><div class="branch-actions"><button class="icon-button branch-action" :disabled="working || repo.busy || !repo.git?.clean" :title="!repo.git?.clean ? '仓库有未提交改动，无法切换分支' : `切换 ${repo.name} 分支`" :aria-label="`切换 ${repo.name} 分支`" @click="openBranch(repo)"><ArrowLeftRight :size="16" /></button><button class="icon-button branch-action branch-build" :disabled="!canBuild || !eligible(repo)" :title="labelFor(repo) || `构建 ${repo.name} Dev`" :aria-label="`构建 ${repo.name} Dev`" @click="build('repositories', [repo.name])"><Play :size="15" /></button></div></div><div v-if="!repositories.length && !loading" class="empty-list">扫描目录中没有发现 Git 仓库。</div></div></section>
        <section class="recent-section">
          <div class="section-title"><div><div class="eyebrow">ACTIVITY</div><h2>最近构建</h2></div><button v-if="builds.length > 5" class="text-button" @click="historyOpen = !historyOpen">{{ historyOpen ? '收起记录' : '更多记录' }} <component :is="historyOpen ? ChevronUp : ChevronDown" :size="15" /></button></div>
          <div v-if="!builds.length" class="empty-list">暂无构建记录</div>
          <div v-for="task in visibleBuilds" :key="task.id" class="recent-row"><span class="result-icon" :class="`state-${task.status}`"><Check v-if="task.status === 'success'" :size="17" /><X v-else-if="task.status === 'failed'" :size="17" /><Square v-else-if="task.status === 'cancelled'" :size="15" /><Clock3 v-else :size="16" /></span><strong>{{ taskLabel(task) }}</strong><span>{{ cancelling === task.id ? '正在终止…' : statusLabel(task.status) }}</span><span>{{ duration(task.duration) }}</span><time>{{ new Date(task.time).toLocaleString() }}</time><div class="recent-actions"><button v-if="task.status === 'running' || task.status === 'pending'" class="stop-link" :disabled="!!cancelling" :aria-label="`终止 ${taskLabel(task)} 构建`" @click="cancelTask(task)"><Square :size="13" />终止</button><button class="result-link" :aria-label="`查看 ${taskLabel(task)} 构建结果`" @click="showTask(task)">查看结果 →</button></div></div>
        </section>
      </template>
    </main>
    <section v-if="active && drawerOpen" class="log-drawer" aria-label="构建日志">
      <div class="drawer-heading">
        <div class="drawer-title"><div class="eyebrow">构建日志</div><h2 :title="taskLabel(active)">{{ taskLabel(active) }}</h2></div>
        <span class="drawer-status" :class="`state-${active.status}`">{{ statusLabel(active.status) }}</span>
        <div class="drawer-meta">{{ new Date(active.time).toLocaleString() }}<span v-if="active.duration !== null"> · {{ duration(active.duration) }}</span></div>
      </div>
      <div class="log-tabs" role="tablist" aria-label="日志业务">
        <button role="tab" :aria-selected="logTab === 'summary'" :class="{ current: logTab === 'summary' }" @click="selectLogTab('summary')">汇总</button>
        <button v-for="step in active.steps" :key="step.repository || 'all'" role="tab" :aria-selected="logTab === (step.repository || 'all')" :class="{ current: logTab === (step.repository || 'all') }" @click="selectLogTab(step.repository || 'all')"><span :class="`state-text-${step.status}`">{{ step.status === 'success' ? '✓' : step.status === 'failed' ? '×' : step.status === 'running' ? '◌' : '○' }}</span> {{ step.repository || '全量' }} <small v-if="step.duration !== null">{{ duration(step.duration) }}</small></button>
      </div>
      <div class="log-toolbar">
        <span class="log-context" :title="selectedStep?.branch || ''">{{ selectedStep ? `${selectedStep.branch} · ${selectedStep.status === 'pending' && (active.status === 'failed' || active.status === 'cancelled') ? '未执行' : statusLabel(selectedStep.status)}` : `${active.steps.filter(step => step.status === 'success').length}/${active.steps.length} 已完成` }}</span>
        <button class="text-button" title="复制日志" @click="copyLogs"><Copy :size="14" />复制</button>
        <button class="text-button" @click="scrollBottom">回到底部</button>
      </div>
      <div ref="logBody" class="log-body" role="log" aria-label="构建输出" @scroll="onLogScroll">
        <div v-if="active.logs.length >= 2000" class="log-notice">仅保留最近 2000 条输出</div>
        <template v-if="visibleLogs.length"><div v-for="(log, index) in visibleLogs" :key="`${log.sequence}-${index}`" class="log-line" :class="log.stream"><time>{{ new Date(log.time).toLocaleTimeString() }}</time><span v-if="logTab === 'summary'" class="log-source">{{ log.repository || '全量' }}</span><span class="log-text">{{ log.text }}</span></div></template>
        <div v-else class="log-empty">{{ selectedStep?.status === 'pending' && active.status === 'failed' ? '因前序业务构建失败，本业务未执行。' : selectedStep?.status === 'pending' && active.status === 'cancelled' ? '构建已终止，本业务未执行。' : !running && !active.logs.length ? '日志已不可用，构建结果仍保留。' : '等待构建输出…' }}</div>
      </div>
      <button v-if="!followOutput" class="jump-bottom" @click="scrollBottom">有新日志 · 回到底部 ↓</button>
      <footer class="drawer-footer"><span>{{ active.steps.length }} 个构建步骤</span><div class="drawer-actions"><button v-if="running" class="button stop-button" :disabled="!!cancelling" @click="cancelTask(active)"><Square :size="13" />{{ cancelling === active.id ? '正在终止…' : '终止构建' }}</button><button class="button secondary drawer-close" @click="drawerOpen = false"><X :size="15" />关闭</button></div></footer>
    </section>
    <div v-if="dialog" class="modal-backdrop" @click.self="dialog = null">
      <section class="modal" role="dialog" aria-modal="true" :aria-label="dialog === 'branch' ? '切换分支' : '项目设置'">
        <div class="modal-head"><h2>{{ dialog === 'branch' ? `切换 ${branchRepo?.name} 分支` : '项目设置' }}</h2><button class="icon-button" title="关闭" aria-label="关闭弹窗" @click="dialog = null"><X :size="17" /></button></div>
        <template v-if="dialog === 'branch'">
          <p class="modal-current">当前分支 <strong>{{ branchRepo?.git?.branch }}</strong></p>
          <label class="branch-search"><Search :size="16" /><input v-model="branchQuery" aria-label="搜索分支" placeholder="搜索分支" /></label>
          <div class="branch-options"><label v-for="branch in branchOptions" :key="branch" class="branch-option"><input v-model="branchTarget" type="radio" name="target-branch" :value="branch" :disabled="branch === branchRepo?.git?.branch" /><span>{{ branch }}</span><small v-if="branch === branchRepo?.git?.branch">当前</small></label><p v-if="!branchOptions.length" class="muted">没有匹配的分支</p></div>
          <div class="modal-actions"><button class="text-button fetch-button" :disabled="working" @click="fetchBranches"><RefreshCw :size="14" :class="{ spin: working }" />获取远程分支</button><button class="button secondary" @click="dialog = null">取消</button><button class="button primary" :disabled="!branchTarget || working" @click="switchBranch">{{ working ? '正在切换…' : '确认切换' }}</button></div>
        </template>
        <template v-else><label class="settings-label">当前主工程</label><select class="settings-select" :value="selected || ''" @change="chooseWorkspace(($event.target as HTMLSelectElement).value); dialog = null"><option v-for="item in workspaces" :key="item.name" :value="item.name">{{ item.name }}</option></select><label class="settings-label">根目录</label><p class="settings-path">{{ workspace?.path }}</p><p class="settings-note">工程目录和扫描范围由服务端 config/workspaces.json 配置。</p></template>
      </section>
    </div>
  </div>
</template>
