import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { AnsiUp } from 'ansi_up';
import type {
  ApiResponse,
  AppConfig,
  BranchItem,
  BranchPickerState,
  DashboardMessage,
  DirectoryPickerState,
  DirtyModalState,
  FieldErrorKey,
  FieldErrors,
  Repository,
  Toast,
  ToastType,
  BuildStatus,
} from './types/dashboard';

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDashboard() {
    const ansiUp = new AnsiUp();

    // 状态定义
    const config = reactive<AppConfig>({
      targetRepoPath: '',
      protectedBranches: ['master', 'main', 'develop', 'test'],
    });

    const fieldErrors = reactive<FieldErrors>({
      targetRepoPath: '',
      protectedBranches: '',
    });

    const repos = ref<Repository[]>([]);
    const targetBranches = reactive<Record<string, string>>({});
    const selectedPackages = ref<string[]>(['all']);

    const buildStatus = reactive<BuildStatus>({
      status: 'idle',
      currentTask: null,
      startTime: null,
      endTime: null,
      pid: null,
    });

    const logs = ref<string[]>([]);
    const autoScroll = ref(true);
    const currentTime = ref(Date.now());

    const loading = reactive({
      refresh: false,
    });

    const toasts = ref<Toast[]>([]);
    // 弹窗状态
    const dirtyModal = reactive<DirtyModalState>({
      show: false,
      repo: null,
      targetBranch: '',
    });

    // VS Code 风格分支选择弹窗状态
    const branchPicker = reactive<BranchPickerState>({
      show: false,
      repo: null,
      search: '',
      tab: 'all', // 'all' | 'local' | 'remote'
    });
    const showSettingsModal = ref(false);
    const directoryPicker = reactive<DirectoryPickerState>({
      show: false,
      loading: false,
      currentPath: '',
      parentPath: null,
      directories: [],
      isProject: false,
      error: '',
    });
    const repoSource = ref('');

    // 计算属性
    const businessRepos = computed<Repository[]>(() => repos.value.filter(r => !r.isRoot));

    // 分支选择弹窗：本地分支列表（根据搜索词过滤，当前分支置顶）
    const pickerLocalBranches = computed<BranchItem[]>(() => {
      if (!branchPicker.repo) return [];
      const current = branchPicker.repo.currentBranch;
      const raw = branchPicker.repo.localBranches || (branchPicker.repo.allBranches || []);
      const set = new Set<string>();
      const list: string[] = [];

      for (const b of raw) {
        if (!b || b === 'HEAD' || b.includes('->')) continue;
        const clean = b.replace(/^origin\//, '').trim();
        if (clean && !set.has(clean)) {
          set.add(clean);
          list.push(clean);
        }
      }

      const kw = (branchPicker.search || '').trim().toLowerCase();
      const filtered = kw ? list.filter(b => b.toLowerCase().includes(kw)) : list;

      return filtered.sort((a, b) => {
        if (a === current) return -1;
        if (b === current) return 1;
        return a.localeCompare(b);
      }).map(name => ({
        key: `local:${name}`,
        name,
        isRemote: false,
        isCurrent: name === current,
      }));
    });

    // 分支选择弹窗：远程分支列表（根据搜索词过滤）
    const pickerRemoteBranches = computed<BranchItem[]>(() => {
      if (!branchPicker.repo) return [];
      const raw = branchPicker.repo.remoteBranches || [];
      const set = new Set<string>();
      const list: string[] = [];

      for (const b of raw) {
        if (!b || b === 'HEAD' || b.includes('->')) continue;
        const clean = b.replace(/^origin\//, '').trim();
        if (clean && !set.has(clean)) {
          set.add(clean);
          list.push(clean);
        }
      }

      const kw = (branchPicker.search || '').trim().toLowerCase();
      const filtered = kw ? list.filter(b => b.toLowerCase().includes(kw)) : list;

      return filtered.sort((a, b) => a.localeCompare(b)).map(name => ({
        key: `remote:${name}`,
        name,
        isRemote: true,
        isCurrent: false,
      }));
    });

    const pickerLocalCount = computed(() => pickerLocalBranches.value.length);
    const pickerRemoteCount = computed(() => pickerRemoteBranches.value.length);

    // 分支选择弹窗：根据 Tab 聚合的分支列表
    const pickerFilteredBranches = computed(() => {
      if (branchPicker.tab === 'local') {
        return pickerLocalBranches.value;
      }
      if (branchPicker.tab === 'remote') {
        return pickerRemoteBranches.value;
      }
      return [...pickerLocalBranches.value, ...pickerRemoteBranches.value];
    });

    const buildStatusText = computed(() => {
      switch (buildStatus.status) {
        case 'running': return '构建中...';
        case 'success': return '构建成功';
        case 'failed': return '构建失败/中止';
        default: return '空闲';
      }
    });

    const buildTimer = computed(() => {
      if (buildStatus.status === 'running' && buildStatus.startTime) {
        const sec = Math.floor((currentTime.value - buildStatus.startTime) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}m ${s}s`;
      }
      return null;
    });

    const formattedLogs = computed(() => {
      return ansiUp.ansi_to_html(logs.value.join(''));
    });

    // Toast 提示
    const showToast = (message: string, type: ToastType = 'success') => {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 3500);
    };

    // ==================== 数据请求与 API ====================

    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const json = await readJson<ApiResponse<AppConfig>>(res);
        if (json.success && json.data) {
          Object.assign(config, json.data);
        }
      } catch (err) {
        console.error('加载配置失败:', err);
      }
    };

    const loadRepos = async (force = false) => {
      loading.refresh = true;
      try {
        const url = force ? '/api/repos?force=true' : '/api/repos';
        const res = await fetch(url);
        const json = await readJson<ApiResponse<Repository[]>>(res);
        if (json.success && json.data) {
          repos.value = json.data;
          repoSource.value = json.source || 'sqlite';
          // 初始化 targetBranches
          for (const r of json.data) {
            if (!targetBranches[r.name]) {
              targetBranches[r.name] = r.currentBranch;
            }
          }
        }
      } catch (err) {
        showToast('获取仓库状态失败: ' + getErrorMessage(err), 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // 强制穿透数据库执行底层全量物理扫描（仅供手动校准使用）
    const forcePhysicalScan = async () => {
      try {
        loading.refresh = true;
        showToast('正在穿透数据库，执行底层 Git 全量物理重扫...');
        await loadRepos(true);
        showToast('已强制刷新最新的 Git 状态并同步回写 SQLite 数据库！');
      } catch (err) {
        showToast('重扫失败: ' + getErrorMessage(err), 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // ==================== Git 分支操作 ====================

    // 打开 VS Code 风格分支选择弹窗
    const openBranchPicker = (repo: Repository) => {
      branchPicker.repo = repo;
      branchPicker.search = '';
      branchPicker.tab = 'all';
      branchPicker.show = true;
    };

    // 分支弹窗中选中分支并执行检出
    const selectBranchAndCheckout = async (item: BranchItem) => {
      if (!item || !item.name) return;
      if (item.isCurrent) {
        showToast(`当前已在分支 ${item.name}`);
        branchPicker.show = false;
        return;
      }
      const repo = branchPicker.repo;
      branchPicker.show = false;
      if (!repo) return;
      await checkoutSingle(repo, item.name);
    };

    const checkoutSingle = async (
      repo: Repository,
      branchName: string | boolean | null = null,
      force = false,
    ) => {
      // 兼容历史调用：若第 2 个参数为布尔值，则为 force 参数
      if (typeof branchName === 'boolean') {
        force = branchName;
        branchName = null;
      }
      force = force === true;

      const targetBranch = (
        branchName ||
        targetBranches[repo.name] ||
        (dirtyModal.repo?.name === repo.name ? dirtyModal.targetBranch : '') ||
        ''
      ).replace(/^origin\//, '');

      if (!targetBranch) {
        showToast('请选择或指定目标分支', 'error');
        return;
      }

      // 同步缓存当前目标分支
      targetBranches[repo.name] = targetBranch;

      try {
        const res = await fetch('/api/git/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path, branch: targetBranch, force }),
        });
        const json = await readJson<ApiResponse>(res);

        if (json.dirty) {
          // 触发脏工作区弹窗
          dirtyModal.repo = repo;
          dirtyModal.targetBranch = targetBranch;
          dirtyModal.show = true;
          return;
        }

        if (json.success) {
          showToast(json.message || `已切到分支 ${targetBranch}`);
          if (json.repos) {
            repos.value = json.repos;
            repoSource.value = 'sqlite';
          } else {
            await loadRepos();
          }
        } else {
          showToast(`切换分支失败: ${json.message || json.stderr}`, 'error');
        }
      } catch (err) {
        showToast('请求失败: ' + getErrorMessage(err), 'error');
      }
    };

    const fetchSingle = async (repo: Repository) => {
      try {
        const res = await fetch('/api/git/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        const json = await readJson<ApiResponse>(res);
        if (json.success) {
          showToast(`${repo.name} 刷新成功`);
          await loadRepos();
        } else {
          showToast(`Fetch 失败: ${json.stderr}`, 'error');
        }
      } catch (err) {
        showToast('请求失败: ' + getErrorMessage(err), 'error');
      }
    };

    // 脏工作区处理
    const handleDirtyStashAndCheckout = async () => {
      const repo = dirtyModal.repo;
      dirtyModal.show = false;
      if (!repo) return;

      try {
        // 1. Stash
        const stashRes = await fetch('/api/git/stash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        const sJson = await readJson<ApiResponse>(stashRes);
        if (!sJson.success) {
          showToast('Stash 失败: ' + sJson.stderr, 'error');
          return;
        }
        showToast('本地改动已自动 Stash 暂存！');

        // 2. Checkout
        await checkoutSingle(repo, false);
      } catch (err) {
        showToast('操作异常: ' + getErrorMessage(err), 'error');
      }
    };

    const handleDirtyResetAndCheckout = async () => {
      const repo = dirtyModal.repo;
      dirtyModal.show = false;
      if (!repo) return;
      if (!confirm(`确定强制丢弃 ${repo.name} 的所有本地改动吗？此操作不可恢复！`)) return;

      try {
        await fetch('/api/git/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        showToast('已强制丢弃本地未提交改动');
        await checkoutSingle(repo, true);
      } catch (err) {
        showToast('操作异常: ' + getErrorMessage(err), 'error');
      }
    };

    // ==================== 构建与打包流水线 ====================

    const toggleSelectPackage = (pkg: string) => {
      if (pkg === 'all') {
        selectedPackages.value = ['all'];
        return;
      }
      // 移除 'all'
      let arr = selectedPackages.value.filter(p => p !== 'all');
      if (arr.includes(pkg)) {
        arr = arr.filter(p => p !== pkg);
      } else {
        arr.push(pkg);
      }
      if (arr.length === 0) arr = ['all'];
      selectedPackages.value = arr;
    };

    const startBuild = async () => {
      try {
        const res = await fetch('/api/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packages: selectedPackages.value,
            mode: 'development',
          }),
        });
        const json = await readJson<ApiResponse>(res);
        if (json.success) {
          showToast('构建任务已启动！');
        } else {
          showToast('启动失败: ' + json.message, 'error');
        }
      } catch (err) {
        showToast('请求异常: ' + getErrorMessage(err), 'error');
      }
    };

    const buildSingle = (repo: Repository) => {
      selectedPackages.value = [repo.packageName];
      startBuild();
    };

    const abortBuild = async () => {
      try {
        const res = await fetch('/api/build/abort', { method: 'POST' });
        const json = await readJson<ApiResponse>(res);
        showToast(json.message || '构建任务状态已更新');
      } catch (err) {}
    };

    const clearConsole = () => {
      logs.value = [];
    };

    // ==================== 系统配置提交时校验逻辑 ====================

    const clearFieldError = (field: FieldErrorKey) => {
      if (fieldErrors[field]) {
        fieldErrors[field] = '';
      }
    };

    const updateProtectedBranches = (str: string) => {
      clearFieldError('protectedBranches');
      config.protectedBranches = str.split(',').map(s => s.trim()).filter(Boolean);
    };

    const browseDirectory = async (targetPath: string | null = '') => {
      directoryPicker.loading = true;
      directoryPicker.error = '';
      try {
        const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
        const res = await fetch(`/api/fs/directories${query}`);
        const json = await readJson<ApiResponse<Omit<DirectoryPickerState, 'show' | 'loading' | 'error'>>>(res);
        if (!res.ok || !json.success) {
          throw new Error(json.message || '无法读取目录');
        }
        Object.assign(directoryPicker, json.data);
        return true;
      } catch (err) {
        directoryPicker.error = getErrorMessage(err);
        return false;
      } finally {
        directoryPicker.loading = false;
      }
    };

    const toggleDirectoryPicker = async () => {
      if (directoryPicker.show) {
        directoryPicker.show = false;
        return;
      }

      directoryPicker.show = true;
      clearFieldError('targetRepoPath');
      const loaded = await browseDirectory(config.targetRepoPath);
      if (!loaded) {
        await browseDirectory();
      }
    };

    const selectCurrentDirectory = () => {
      if (!directoryPicker.currentPath || !directoryPicker.isProject) return;
      config.targetRepoPath = directoryPicker.currentPath;
      clearFieldError('targetRepoPath');
      directoryPicker.show = false;
    };

    // 弹窗打开时清空旧的错误提示，保持干净界面
    watch(showSettingsModal, (isOpen) => {
      if (isOpen) {
        fieldErrors.targetRepoPath = '';
        fieldErrors.protectedBranches = '';
      } else {
        directoryPicker.show = false;
      }
    });

    const saveSystemSettings = async () => {
      // 1. 提交前清空所有字段报错
      fieldErrors.targetRepoPath = '';
      fieldErrors.protectedBranches = '';

      // 2. 前端基础合法性校验
      const targetPath = (config.targetRepoPath || '').trim();
      config.targetRepoPath = targetPath;
      let hasError = false;

      if (!targetPath) {
        fieldErrors.targetRepoPath = '目标 Monorepo 根路径不能为空！';
        hasError = true;
      }

      if (hasError) {
        showToast('配置项存在不合法内容，请根据标红提示修正！', 'error');
        return;
      }

      // 3. 发送保存请求，若后端返回不合法则精准标红对应输入项
      try {
        loading.refresh = true;
        showToast('正在校验并保存配置...');
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        const json = await readJson<ApiResponse<AppConfig>>(res);
        if (json.success) {
          showToast(json.message || '系统设置已成功保存！');
          showSettingsModal.value = false;
          // 仅当后端因路径变更返回了全新落库的大盘数据时才刷新仓库视图
          if (json.repos && Array.isArray(json.repos)) {
            repos.value = json.repos;
            repoSource.value = 'sqlite';
            selectedPackages.value = [];
            for (const r of json.repos) {
              targetBranches[r.name] = r.currentBranch;
            }
          }
        } else {
          // 提交时不合法：精准在对应输入框下方提示，输入框标红
          const errField = json.field || 'targetRepoPath';
          fieldErrors[errField] = json.message || '配置校验失败，请检查输入！';
          showToast('保存被拦截: ' + (json.message || '配置校验失败'), 'error');
        }
      } catch (err) {
        showToast('保存失败: ' + getErrorMessage(err), 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // ==================== WebSocket 连接 ====================

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let clockTimer: ReturnType<typeof setInterval> | null = null;
    let isUnmounted = false;

    const connectWebSocket = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/ws`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('[WS] WebSocket 已连接');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as DashboardMessage;
          if (msg.type === 'init') {
            Object.assign(buildStatus, msg.data.status);
            logs.value = msg.data.logs || [];
          } else if (msg.type === 'log') {
            logs.value.push(msg.data);
            if (logs.value.length > 2500) logs.value.shift();
          } else if (msg.type === 'log_clear') {
            logs.value = [];
          } else if (msg.type === 'build_status') {
            Object.assign(buildStatus, msg.data);
            if (msg.data.status === 'success' || msg.data.status === 'failed') {
              loadRepos(true); // 自动刷新仓库状态并同步数据库
            }
          } else if (msg.type === 'repos_updated') {
            repos.value = msg.data;
            repoSource.value = 'sqlite';
            for (const r of msg.data) {
              if (!targetBranches[r.name]) {
                targetBranches[r.name] = r.currentBranch;
              }
            }
          }
        } catch (err) {}
      };

      socket.onclose = () => {
        if (isUnmounted) return;
        console.warn('[WS] WebSocket 断开，3秒后自动重连...');
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      };
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (directoryPicker.show) directoryPicker.show = false;
      else if (branchPicker.show) branchPicker.show = false;
    };

    // 初始化：并行发出请求，秒级渲染
    onMounted(async () => {
      window.addEventListener('keydown', handleKeydown);
      clockTimer = setInterval(() => {
        currentTime.value = Date.now();
      }, 1000);

      await Promise.all([
        loadConfig(),
        loadRepos(false),
      ]);
      if (!isUnmounted) connectWebSocket();
    });

    onUnmounted(() => {
      isUnmounted = true;
      window.removeEventListener('keydown', handleKeydown);
      if (clockTimer !== null) clearInterval(clockTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
    });

    return {
      config,
      repos,
      repoSource,
      businessRepos,
      targetBranches,
      selectedPackages,
      buildStatus,
      buildStatusText,
      buildTimer,
      formattedLogs,
      autoScroll,
      loading,
      toasts,
      dirtyModal,
      branchPicker,
      openBranchPicker,
      selectBranchAndCheckout,
      pickerFilteredBranches,
      pickerLocalCount,
      pickerRemoteCount,
      showSettingsModal,
      directoryPicker,
      browseDirectory,
      toggleDirectoryPicker,
      selectCurrentDirectory,
      toggleSelectPackage,
      startBuild,
      buildSingle,
      abortBuild,
      clearConsole,
      forcePhysicalScan,
      fetchSingle,
      handleDirtyStashAndCheckout,
      handleDirtyResetAndCheckout,
      updateProtectedBranches,
      saveSystemSettings,
      fieldErrors,
    };
}
