<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { ArrowLeft, ArrowRight, GitBranch, GitCommitHorizontal, RefreshCw, Download, Play, Terminal, FolderGit2, CircleCheck, CircleAlert } from 'lucide-vue-next';

type BuildState = 'pending' | 'running' | 'success' | 'failed';
interface BuildRecord { id: string; project: string; branch: string; time: string; status: BuildState; duration: number | null }
interface GitInfo { branch: string; hash: string; message: string; clean: boolean; localBranches: string[]; remoteBranches: string[] }
interface Project { name: string; path: string; buildCommand: string; git: GitInfo | null; latestBuild: BuildRecord | null; error?: string }
interface Log { stream: string; text: string; buildId: string }
interface Detail extends Project { history: BuildRecord[]; logs: Log[]; busy: boolean }

const projects = ref<Project[]>([]);
const selected = ref<string | null>(decodeURIComponent(location.pathname.match(/^\/projects\/([^/]+)$/)?.[1] || '') || null);
const detail = ref<Detail | null>(null);
const loading = ref(false);
const working = ref(false);
const error = ref('');
const branch = ref('');
const listBranches = ref<Record<string, string>>({});
const terminal = ref<HTMLElement | null>(null);
const connected = ref(false);
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

const current = computed(() => projects.value.find((project) => project.name === selected.value));
const branches = computed(() => detail.value?.git ? [...new Set([...detail.value.git.localBranches, ...detail.value.git.remoteBranches])] : []);

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  return body as T;
}

async function loadProjects() {
  loading.value = true;
  try {
    projects.value = await request<Project[]>('/api/projects');
    error.value = '';
  } catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
}

async function loadDetail() {
  if (!selected.value) return;
  try {
    detail.value = await request<Detail>(`/api/projects/${encodeURIComponent(selected.value)}`);
    branch.value = detail.value.git?.branch || '';
    error.value = '';
    scrollTerminal();
  } catch (cause) { error.value = (cause as Error).message; }
}

function navigate(name: string | null) {
  selected.value = name;
  detail.value = null;
  history.pushState({}, '', name ? `/projects/${encodeURIComponent(name)}` : '/');
  if (name) void loadDetail();
}

function onPopState() {
  selected.value = decodeURIComponent(location.pathname.match(/^\/projects\/([^/]+)$/)?.[1] || '') || null;
  detail.value = null;
  if (selected.value) void loadDetail();
}

function scrollTerminal() { void nextTick(() => { if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight; }); }

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => { connected.value = true; void loadProjects(); if (selected.value) void loadDetail(); };
  socket.onclose = () => { connected.value = false; reconnectTimer = setTimeout(connect, 2000); };
  socket.onmessage = (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as { type: string; project: string; record?: BuildRecord; git?: GitInfo; busy?: boolean; stream?: string; text?: string; buildId?: string };
    const item = projects.value.find((project) => project.name === message.project);
    if (message.type === 'git' && message.git) {
      if (item) item.git = message.git;
      if (detail.value?.name === message.project) detail.value.git = message.git;
    }
    if (message.type === 'build' && message.record) {
      if (item) item.latestBuild = { ...message.record };
      if (detail.value?.name === message.project) {
        detail.value.latestBuild = { ...message.record };
        const index = detail.value.history.findIndex((record) => record.id === message.record?.id);
        if (index < 0) detail.value.history.unshift({ ...message.record });
        else detail.value.history[index] = { ...message.record };
      }
    }
    if (detail.value?.name !== message.project) return;
    if (message.type === 'busy') detail.value.busy = !!message.busy;
    if (message.type === 'log' && message.text) {
      detail.value.logs.push({ stream: message.stream || 'stdout', text: message.text, buildId: message.buildId || '' });
      if (detail.value.logs.length > 2000) detail.value.logs.splice(0, detail.value.logs.length - 2000);
      scrollTerminal();
    }
  };
}

async function action(name: string, kind: 'fetch' | 'pull' | 'checkout' | 'build', target?: string) {
  working.value = true;
  error.value = '';
  try {
    if (kind === 'build') {
      if (detail.value?.name === name) detail.value.logs = [];
      await request(`/api/projects/${encodeURIComponent(name)}/build`, { method: 'POST' });
    } else {
      await request(`/api/projects/${encodeURIComponent(name)}/git`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: kind, branch: target }),
      });
    }
    await loadProjects();
    if (selected.value === name) await loadDetail();
  } catch (cause) { error.value = (cause as Error).message; }
  finally { working.value = false; }
}

function date(value: string) { return new Date(value).toLocaleString(); }
function duration(value: number | null) { return value === null ? '—' : `${(value / 1000).toFixed(1)}s`; }

onMounted(() => { void loadProjects(); if (selected.value) void loadDetail(); connect(); window.addEventListener('popstate', onPopState); });
onUnmounted(() => { clearTimeout(reconnectTimer); if (socket) { socket.onclose = null; socket.close(); } window.removeEventListener('popstate', onPopState); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" @click="navigate(null)" title="返回项目列表"><span class="brand-mark"><Terminal :size="19" /></span><span>VBEN <strong>CONTROL</strong></span></button>
      <div class="topbar-right"><span class="connection" :class="{ online: connected }"><span class="dot" />{{ connected ? 'AGENT ONLINE' : 'AGENT OFFLINE' }}</span><span class="top-separator" /><span class="top-caption">REMOTE WORKSPACE</span></div>
    </header>

    <main class="workspace">
      <div v-if="error" class="alert"><CircleAlert :size="17" />{{ error }}<button @click="error = ''" aria-label="关闭错误">×</button></div>
      <template v-if="!selected">
        <div class="page-heading"><div><div class="eyebrow">WORKSPACE / PROJECTS</div><h1>项目</h1><p>远程仓库与构建</p></div><button class="button secondary" :disabled="loading" @click="loadProjects"><RefreshCw :size="15" :class="{ spin: loading }" />刷新</button></div>
        <div class="section-heading"><span>已配置项目</span><span class="count">{{ projects.length }}</span></div>
        <div v-if="!projects.length && !loading" class="empty">没有配置项目。请在服务器的 config/projects.json 中添加项目。</div>
        <div class="project-list">
          <article v-for="project in projects" :key="project.name" class="project-row">
            <button class="project-main" @click="navigate(project.name)"><span class="project-icon"><FolderGit2 :size="20" /></span><span class="project-identity"><strong>{{ project.name }}</strong><small :title="project.path">{{ project.path }}</small></span><ArrowRight :size="17" class="project-arrow" /></button>
            <div class="project-meta"><span class="branch-label"><GitBranch :size="14" />{{ project.git?.branch || '不可用' }}</span><span class="commit-label" :title="project.git?.message"><GitCommitHorizontal :size="14" />{{ project.git?.hash || '—' }} <span>{{ project.git?.message }}</span></span></div>
            <div class="project-end"><span v-if="project.error" class="state danger" :title="project.error">读取失败</span><span v-else class="state" :class="project.git?.clean ? 'good' : 'warn'">{{ project.git?.clean ? '工作区干净' : '有本地改动' }}</span><span class="build-indicator" :class="project.latestBuild?.status || ''">{{ project.latestBuild?.status || '无构建记录' }}</span><button class="icon-button" title="查看详情" :aria-label="`查看 ${project.name}`" @click="navigate(project.name)"><ArrowRight :size="17" /></button></div>
            <div class="project-actions"><button class="button secondary" :disabled="working || loading" @click="loadProjects"><RefreshCw :size="14" />刷新</button><select v-model="listBranches[project.name]" :aria-label="`${project.name} 分支`" :disabled="working || !project.git"><option value="" disabled>选择分支</option><option v-for="name in [...new Set([...(project.git?.localBranches || []), ...(project.git?.remoteBranches || [])])]" :key="name" :value="name">{{ name }}</option></select><button class="button secondary" :disabled="working || !listBranches[project.name] || listBranches[project.name] === project.git?.branch" @click="action(project.name, 'checkout', listBranches[project.name])"><GitBranch :size="14" />切换</button><button class="button secondary" :disabled="working || !project.git" @click="action(project.name, 'pull')"><Download :size="14" />Pull</button><button class="button primary" :disabled="working || !project.git || project.latestBuild?.status === 'running'" @click="action(project.name, 'build')"><Play :size="14" fill="currentColor" />Build</button></div>
          </article>
        </div>
      </template>
      <template v-else>
        <button class="back-link" @click="navigate(null)"><ArrowLeft :size="16" />所有项目</button>
        <div class="page-heading detail-heading"><div><div class="eyebrow">WORKSPACE / {{ selected.toUpperCase() }}</div><h1>{{ selected }}</h1><p>{{ detail?.path || current?.path }}</p></div><button class="button secondary" @click="loadDetail"><RefreshCw :size="15" />刷新</button></div>
        <template v-if="detail">
          <div class="detail-grid">
            <section class="git-section"><div class="section-heading"><span>GIT 状态</span><GitBranch :size="16" /></div><div class="info-line"><span>当前分支</span><strong>{{ detail.git?.branch }}</strong></div><div class="info-line"><span>最新提交</span><strong class="mono">{{ detail.git?.hash }}</strong></div><div class="info-line"><span>提交信息</span><strong class="message">{{ detail.git?.message }}</strong></div><div class="info-line"><span>工作区</span><strong :class="detail.git?.clean ? 'text-good' : 'text-warn'">{{ detail.git?.clean ? '干净' : '有本地改动' }}</strong></div><div class="action-group"><button class="button secondary" :disabled="working || detail.busy" @click="action(detail.name, 'fetch')"><RefreshCw :size="15" />Fetch</button><button class="button secondary" :disabled="working || detail.busy" @click="action(detail.name, 'pull')"><Download :size="15" />Pull</button></div></section>
            <section class="control-section"><div class="section-heading"><span>操作</span><Terminal :size="16" /></div><label for="branch">切换分支</label><div class="branch-control"><select id="branch" v-model="branch" :disabled="working || detail.busy"><option v-for="name in branches" :key="name" :value="name">{{ name }}</option></select><button class="button secondary" :disabled="working || detail.busy || !branch || branch === detail.git?.branch" @click="action(detail.name, 'checkout', branch)">切换</button></div><div class="control-divider" /><label>构建命令</label><div class="command">{{ detail.buildCommand }}</div><button class="button primary" :disabled="working || detail.busy" @click="action(detail.name, 'build')"><Play :size="15" fill="currentColor" />开始构建</button></section>
          </div>
          <section class="terminal-section"><div class="terminal-header"><div class="terminal-title"><Terminal :size="16" /> TERMINAL <span class="terminal-subtitle">{{ detail.latestBuild?.status === 'running' ? 'BUILD RUNNING' : 'OUTPUT' }}</span></div><span class="live-tag"><span class="dot" :class="{ online: connected }" />LIVE</span></div><div ref="terminal" class="terminal-body" role="log" aria-live="polite"><div v-if="!detail.logs.length" class="terminal-empty">等待构建输出...</div><span v-for="(log, index) in detail.logs" :key="index" :class="log.stream">{{ log.text }}</span></div></section>
          <section class="history-section"><div class="section-heading"><span>构建历史</span><span class="count">{{ detail.history.length }}</span></div><div v-if="!detail.history.length" class="empty">暂无构建记录</div><div v-for="record in detail.history" :key="record.id" class="history-row"><span class="history-icon" :class="record.status"><CircleCheck v-if="record.status === 'success'" :size="17" /><CircleAlert v-else-if="record.status === 'failed'" :size="17" /><RefreshCw v-else :size="17" /></span><span class="history-status" :class="record.status">{{ record.status }}</span><span class="history-branch"><GitBranch :size="13" />{{ record.branch }}</span><span class="history-time">{{ date(record.time) }}</span><span class="history-duration">{{ duration(record.duration) }}</span></div></section>
        </template>
      </template>
    </main>
    <footer class="footer"><span>VBEN CONTROL / PERSONAL REMOTE WORKSPACE</span><span>{{ connected ? 'CONNECTED' : 'DISCONNECTED' }}</span></footer>
  </div>
</template>
