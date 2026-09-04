const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    const ansiUp = new AnsiUp();

    // 状态定义
    const config = reactive({
      targetRepoPath: '',
      maxMemoryMb: 8192,
      allowParallel: true,
      protectedBranches: ['master', 'main', 'develop', 'test'],
      deployTargets: {},
      autoDeployAfterBuild: false,
      selectedNodeVersion: '',
    });

    const repos = ref([]);
    const targetBranches = reactive({});
    const selectedPackages = ref(['all']);

    const buildMode = ref('development');
    const buildParallel = ref(true);
    const buildMaxMemory = ref(8192);

    const buildStatus = reactive({
      status: 'idle',
      currentTask: '',
      startTime: null,
      endTime: null,
      pid: null,
    });

    const logs = ref([]);
    const autoScroll = ref(true);
    const consoleBody = ref(null);

    const memory = reactive({
      totalMb: 0,
      usedMb: 0,
      freeMb: 0,
      percent: 0,
      processRssMb: 0,
    });

    const runtime = reactive({
      current: '',
      versions: [],
      pnpmVersion: '',
    });

    const loading = reactive({
      refresh: false,
    });

    const toasts = ref([]);
    const newNodeVersion = ref('');

    // 弹窗状态
    const dirtyModal = reactive({
      show: false,
      repo: null,
      targetBranch: '',
    });

    const batchModal = reactive({
      show: false,
      branch: '',
    });

    const branchDrawer = reactive({
      show: false,
      repo: null,
      loading: false,
      keyword: '',
      onlyMergedOrGone: false,
      branches: [],
      currentBranch: '',
      selected: [],
    });

    const showEnvModal = ref(false);
    const showSettingsModal = ref(false);
    const repoSource = ref('');

    // 计算属性
    const businessRepos = computed(() => repos.value.filter(r => !r.isRoot));

    const filteredLocalBranches = computed(() => {
      let list = branchDrawer.branches || [];
      const kw = (branchDrawer.keyword || '').trim().toLowerCase();
      if (kw) {
        list = list.filter(b =>
          (b.name && b.name.toLowerCase().includes(kw)) ||
          (b.subject && b.subject.toLowerCase().includes(kw))
        );
      }
      if (branchDrawer.onlyMergedOrGone) {
        list = list.filter(b => b.isMerged || b.isGone);
      }
      return list;
    });

    const deletableFilteredCount = computed(() => {
      return filteredLocalBranches.value.filter(b => b.canDelete).length;
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
        const sec = Math.floor((Date.now() - buildStatus.startTime) / 1000);
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
    const showToast = (message, type = 'success') => {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 3500);
    };

    const formatTime = (dateStr) => {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const isProtectedBranch = (branchName) => {
      return (config.protectedBranches || []).includes(branchName);
    };

    // 滚动控制台到底部
    const scrollToBottom = () => {
      if (!autoScroll.value || !consoleBody.value) return;
      nextTick(() => {
        consoleBody.value.scrollTop = consoleBody.value.scrollHeight;
      });
    };

    // ==================== 数据请求与 API ====================

    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config');
        const json = await res.json();
        if (json.success && json.data) {
          Object.assign(config, json.data);
          buildParallel.value = json.data.allowParallel ?? true;
          buildMaxMemory.value = json.data.maxMemoryMb ?? 8192;
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
        const json = await res.json();
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
        showToast('获取仓库状态失败: ' + err.message, 'error');
      } finally {
        loading.refresh = false;
      }
    };

    const loadRuntime = async () => {
      try {
        const res = await fetch('/api/env/runtime');
        const json = await res.json();
        if (json.success && json.data) {
          Object.assign(runtime, json.data);
        }
      } catch (err) {}
    };

    // 1. 极速从 SQLite 数据库刷新大盘快照（0毫秒秒开，纯只读数据库，绝不扫描底层磁盘）
    const refreshFromDb = async () => {
      loading.refresh = true;
      try {
        await loadRepos(false);
        showToast('已从 SQLite 数据库极速刷新最新快照！');
      } finally {
        loading.refresh = false;
      }
    };

    // 2. 抓取远程最新分支并同步入库
    const fetchRemoteBranches = async () => {
      try {
        loading.refresh = true;
        showToast('正在同步远程最新分支 (git fetch -p)...');
        const res = await fetch('/api/git/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (json.success && json.repos) {
          repos.value = json.repos;
          repoSource.value = 'sqlite';
          for (const r of json.repos) {
            targetBranches[r.name] = r.currentBranch;
          }
          showToast('已完成全局远程分支抓取并落库！');
        } else {
          showToast('同步失败: ' + (json.message || '未知错误'), 'error');
        }
      } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // 3. 强制穿透数据库执行底层全量物理扫描（仅供手动校准使用）
    const forcePhysicalScan = async () => {
      try {
        loading.refresh = true;
        showToast('正在穿透数据库，执行底层 Git 全量物理重扫...');
        await loadRepos(true);
        showToast('已强制刷新最新的 Git 状态并同步回写 SQLite 数据库！');
      } catch (err) {
        showToast('重扫失败: ' + err.message, 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // 兼容历史调用：若显式传入布尔值 true 则执行重扫，否则一律执行极速数据库刷新（安全避免 PointerEvent 误判）
    const fetchAndRefresh = async (forceScanOnly = false) => {
      if (typeof forceScanOnly === 'boolean' && forceScanOnly) {
        return forcePhysicalScan();
      }
      return refreshFromDb();
    };

    // ==================== Git 分支操作 ====================

    const checkoutSingle = async (repo, force = false) => {
      const targetBranch = (targetBranches[repo.name] || '').replace(/^origin\//, '');
      if (!targetBranch) return;

      try {
        const res = await fetch('/api/git/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path, branch: targetBranch, force }),
        });
        const json = await res.json();

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
        showToast('请求失败: ' + err.message, 'error');
      }
    };

    const fetchSingle = async (repo) => {
      try {
        const res = await fetch('/api/git/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(`${repo.name} 刷新成功`);
          await loadRepos();
        } else {
          showToast(`Fetch 失败: ${json.stderr}`, 'error');
        }
      } catch (err) {
        showToast('请求失败: ' + err.message, 'error');
      }
    };

    // 脏工作区处理
    const handleDirtyStashAndCheckout = async () => {
      const repo = dirtyModal.repo;
      const targetBranch = dirtyModal.targetBranch;
      dirtyModal.show = false;

      try {
        // 1. Stash
        const stashRes = await fetch('/api/git/stash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        const sJson = await stashRes.json();
        if (!sJson.success) {
          showToast('Stash 失败: ' + sJson.stderr, 'error');
          return;
        }
        showToast('本地改动已自动 Stash 暂存！');

        // 2. Checkout
        await checkoutSingle(repo, false);
      } catch (err) {
        showToast('操作异常: ' + err.message, 'error');
      }
    };

    const handleDirtyResetAndCheckout = async () => {
      const repo = dirtyModal.repo;
      dirtyModal.show = false;
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
        showToast('操作异常: ' + err.message, 'error');
      }
    };

    // 批量切分支
    const openBatchCheckoutModal = () => {
      batchModal.branch = '';
      batchModal.show = true;
    };

    const executeBatchCheckout = async () => {
      if (!batchModal.branch) return;
      const branchName = batchModal.branch.trim();
      batchModal.show = false;

      try {
        showToast(`正在为所有匹配子包切换到 ${branchName}...`);
        const res = await fetch('/api/git/batch-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: branchName }),
        });
        const json = await res.json();
        if (json.success) {
          showToast('批量联动切换操作已完成！');
          if (json.repos) {
            repos.value = json.repos;
            repoSource.value = 'sqlite';
            for (const r of json.repos) {
              targetBranches[r.name] = r.currentBranch;
            }
          } else {
            await loadRepos();
          }
        }
      } catch (err) {
        showToast('批量切换失败: ' + err.message, 'error');
      }
    };

    // 分支清理
    const pruneAllMergedBranches = async () => {
      if (!confirm('确定清理所有子仓中已合并到主分支或远程已失效的历史分支吗？')) return;
      try {
        const res = await fetch('/api/git/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || '全局清理完成！');
          if (json.repos) {
            repos.value = json.repos;
            repoSource.value = 'sqlite';
            for (const r of json.repos) {
              targetBranches[r.name] = r.currentBranch;
            }
          } else {
            await loadRepos();
          }
        }
      } catch (err) {
        showToast('清理失败: ' + err.message, 'error');
      }
    };

    const selectAllDeletable = () => {
      const deletableNames = filteredLocalBranches.value
        .filter(b => b.canDelete)
        .map(b => b.name);
      branchDrawer.selected = Array.from(new Set([...branchDrawer.selected, ...deletableNames]));
    };

    const loadLocalBranches = async (repoPath) => {
      if (!repoPath) return;
      branchDrawer.loading = true;
      try {
        const res = await fetch(`/api/git/local-branches?repoPath=${encodeURIComponent(repoPath)}`);
        const json = await res.json();
        if (json.success && json.data) {
          branchDrawer.currentBranch = json.data.currentBranch || '';
          branchDrawer.branches = json.data.branches || [];
          const validNames = new Set(branchDrawer.branches.filter(b => b.canDelete).map(b => b.name));
          branchDrawer.selected = branchDrawer.selected.filter(name => validNames.has(name));
        } else {
          showToast('获取本地分支列表失败: ' + (json.message || '未知错误'), 'error');
        }
      } catch (err) {
        showToast('获取本地分支列表失败: ' + err.message, 'error');
      } finally {
        branchDrawer.loading = false;
      }
    };

    const openBranchDrawer = (repo) => {
      branchDrawer.repo = repo;
      branchDrawer.selected = [];
      branchDrawer.keyword = '';
      branchDrawer.onlyMergedOrGone = false;
      branchDrawer.branches = [];
      branchDrawer.show = true;
      loadLocalBranches(repo.path);
    };

    const pruneRepoBranches = async (repo) => {
      try {
        showToast('正在清理本地已合并/失效分支...');
        const res = await fetch('/api/git/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoPath: repo.path }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.data?.message || '本地分支清理完成！');
          await loadRepos();
          await loadLocalBranches(repo.path);
        }
      } catch (err) {
        showToast('清理失败: ' + err.message, 'error');
      }
    };

    const deleteSingleBranch = async (branchName) => {
      if (!confirm(`确定删除本地分支 "${branchName}" 吗？此操作不可逆（仅在本地删除，不影响远程）。`)) return;
      try {
        const res = await fetch('/api/git/delete-branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoPath: branchDrawer.repo.path,
            branches: [branchName],
          }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(`已删除本地分支 ${branchName}`);
          await loadRepos();
          await loadLocalBranches(branchDrawer.repo.path);
        } else {
          showToast('删除失败: ' + (json.message || '未知错误'), 'error');
        }
      } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
      }
    };

    const deleteSelectedBranches = async () => {
      if (branchDrawer.selected.length === 0) return;
      if (!confirm(`确定彻底删除选中的 ${branchDrawer.selected.length} 个本地分支吗？此操作仅在本地生效，不影响远程仓库。`)) return;

      try {
        const res = await fetch('/api/git/delete-branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoPath: branchDrawer.repo.path,
            branches: branchDrawer.selected,
          }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(`已删除 ${json.data.deleted?.length || 0} 个本地分支`);
          await loadRepos();
          branchDrawer.selected = [];
          await loadLocalBranches(branchDrawer.repo.path);
        }
      } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
      }
    };

    // ==================== 构建与打包流水线 ====================

    const toggleSelectPackage = (pkg) => {
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
            mode: buildMode.value,
            allowParallel: buildParallel.value,
            maxMemoryMb: buildMaxMemory.value,
            nodeVersion: config.selectedNodeVersion,
          }),
        });
        const json = await res.json();
        if (json.success) {
          showToast('构建任务已启动！');
        } else {
          showToast('启动失败: ' + json.message, 'error');
        }
      } catch (err) {
        showToast('请求异常: ' + err.message, 'error');
      }
    };

    const buildSingle = (repo) => {
      selectedPackages.value = [repo.packageName];
      startBuild();
    };

    const abortBuild = async () => {
      try {
        const res = await fetch('/api/build/abort', { method: 'POST' });
        const json = await res.json();
        showToast(json.message);
      } catch (err) {}
    };

    const clearConsole = () => {
      logs.value = [];
    };

    // ==================== 产物下载与定向传输 ====================

    const downloadZip = (repo) => {
      const url = `/api/deploy/download/${encodeURIComponent(repo.packageName)}`;
      window.open(url, '_blank');
    };

    const syncSingle = async (repo) => {
      const targetDir = config.deployTargets?.[repo.packageName];
      if (!targetDir) {
        showToast(`请先在系统设置中配置 ${repo.packageName} 的目标部署目录！`, 'error');
        showSettingsModal.value = true;
        return;
      }

      if (!confirm(`确定将 ${repo.packageName} 的最新 dist 产物传输至 ${targetDir} 吗？`)) return;

      try {
        const res = await fetch('/api/deploy/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appName: repo.packageName,
            destinationPath: targetDir,
          }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || '传输成功！');
        } else {
          showToast('传输失败: ' + json.message, 'error');
        }
      } catch (err) {
        showToast('传输异常: ' + err.message, 'error');
      }
    };

    // ==================== 环境维护与设置 ====================

    const installDeps = async (cleanLock) => {
      try {
        await fetch('/api/env/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleanLock, nodeVersion: config.selectedNodeVersion }),
        });
        showToast('已发起依赖安装任务，请在终端查看输出');
        showEnvModal.value = false;
      } catch (err) {
        showToast('发起任务失败: ' + err.message, 'error');
      }
    };

    const cleanCache = async () => {
      if (!confirm('确定清理项目中所有的构建缓存（.turbo、dist、.vite）吗？')) return;
      try {
        await fetch('/api/env/clean-cache', { method: 'POST' });
        showToast('构建缓存清理完成');
      } catch (err) {}
    };

    const cleanModules = async () => {
      if (!confirm('确定彻底删除项目中所有的 node_modules 目录吗？后续需重新安装依赖。')) return;
      try {
        await fetch('/api/env/clean-modules', { method: 'POST' });
        showToast('node_modules 清理完毕');
      } catch (err) {}
    };

    const saveNodeVersion = async () => {
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedNodeVersion: config.selectedNodeVersion }),
        });
        showToast(`已指定构建使用 Node: ${config.selectedNodeVersion || '默认系统版本'}`);
      } catch (err) {}
    };

    const installNewNodeVersion = async () => {
      if (!newNodeVersion.value) return;
      const v = newNodeVersion.value.trim();
      try {
        showToast(`正在通过 nvm install ${v} ...`);
        const res = await fetch('/api/env/node/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: v }),
        });
        const json = await res.json();
        if (json.success) {
          showToast(`Node ${v} 安装成功！`);
          await loadRuntime();
          newNodeVersion.value = '';
        } else {
          showToast('安装失败: ' + json.error, 'error');
        }
      } catch (err) {
        showToast('请求异常: ' + err.message, 'error');
      }
    };

    const updateProtectedBranches = (str) => {
      config.protectedBranches = str.split(',').map(s => s.trim()).filter(Boolean);
    };

    const saveSystemSettings = async () => {
      const targetPath = (config.targetRepoPath || '').trim();
      if (!targetPath) {
        showToast('目标 Monorepo 根路径不能为空！', 'error');
        return;
      }
      if (config.maxMemoryMb && Number(config.maxMemoryMb) < 512) {
        showToast('构建最大内存上限不能低于 512 MB！', 'error');
        return;
      }

      try {
        loading.refresh = true;
        showToast('正在校验并保存配置...');
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || '系统设置已成功保存！');
          showSettingsModal.value = false;
          if (json.repos && Array.isArray(json.repos)) {
            repos.value = json.repos;
            repoSource.value = 'sqlite';
            selectedPackages.value = [];
            for (const r of json.repos) {
              targetBranches[r.name] = r.currentBranch;
            }
          } else {
            await loadRepos(true);
          }
        } else {
          showToast('保存被拦截: ' + (json.message || '配置校验失败'), 'error');
        }
      } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
      } finally {
        loading.refresh = false;
      }
    };

    // ==================== WebSocket 连接 ====================

    const connectWebSocket = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}/ws`;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('[WS] WebSocket 已连接');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init') {
            Object.assign(buildStatus, msg.data.status);
            logs.value = msg.data.logs || [];
            scrollToBottom();
          } else if (msg.type === 'log') {
            logs.value.push(msg.data);
            if (logs.value.length > 2500) logs.value.shift();
            scrollToBottom();
          } else if (msg.type === 'log_clear') {
            logs.value = [];
          } else if (msg.type === 'build_status') {
            Object.assign(buildStatus, msg.data);
            if (msg.data.status === 'success' || msg.data.status === 'failed') {
              loadRepos(true); // 自动刷新仓库状态并同步数据库
            }
          } else if (msg.type === 'memory') {
            Object.assign(memory, msg.data);
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
        console.warn('[WS] WebSocket 断开，3秒后自动重连...');
        setTimeout(connectWebSocket, 3000);
      };
    };

    // 初始化：并行发出请求，秒级渲染
    onMounted(async () => {
      await Promise.all([
        loadConfig(),
        loadRepos(false),
        loadRuntime(),
      ]);
      connectWebSocket();
    });

    return {
      config,
      repos,
      repoSource,
      businessRepos,
      targetBranches,
      selectedPackages,
      buildMode,
      buildParallel,
      buildMaxMemory,
      buildStatus,
      buildStatusText,
      buildTimer,
      logs,
      formattedLogs,
      autoScroll,
      consoleBody,
      memory,
      runtime,
      loading,
      toasts,
      dirtyModal,
      batchModal,
      branchDrawer,
      showEnvModal,
      showSettingsModal,
      newNodeVersion,
      toggleSelectPackage,
      startBuild,
      buildSingle,
      abortBuild,
      clearConsole,
      downloadZip,
      syncSingle,
      refreshFromDb,
      fetchRemoteBranches,
      forcePhysicalScan,
      fetchAndRefresh,
      checkoutSingle,
      fetchSingle,
      handleDirtyStashAndCheckout,
      handleDirtyResetAndCheckout,
      openBatchCheckoutModal,
      executeBatchCheckout,
      pruneAllMergedBranches,
      openBranchDrawer,
      loadLocalBranches,
      selectAllDeletable,
      deleteSingleBranch,
      filteredLocalBranches,
      deletableFilteredCount,
      pruneRepoBranches,
      deleteSelectedBranches,
      isProtectedBranch,
      installDeps,
      cleanCache,
      cleanModules,
      saveNodeVersion,
      installNewNodeVersion,
      updateProtectedBranches,
      saveSystemSettings,
      formatTime,
    };
  },
}).mount('#app');
