import Koa from 'koa';
import Router from '@koa/router';
import serve from 'koa-static';
import bodyParser from 'koa-bodyparser';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { getConfig, saveConfig, validateConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { buildManager } from './lib/build.mjs';
import * as monitor from './lib/monitor.mjs';
import * as nvm from './lib/nvm.mjs';
import * as sync from './lib/sync.mjs';
import * as db from './lib/db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Koa();
const router = new Router({ prefix: '/api' });

// 1. 全局异常处理中间件
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error(`[Error] ${ctx.method} ${ctx.url} - ${err.message}`);
    ctx.status = err.status || 500;
    ctx.body = {
      success: false,
      message: err.message || '内部服务器错误',
    };
  }
});

app.use(bodyParser());
app.use(serve(path.join(__dirname, 'public')));

// ==================== 后台 Git 异步扫描任务 ====================
let isScanning = false;
async function triggerBackgroundScan(targetRepoPath) {
  if (isScanning) return;
  isScanning = true;
  try {
    const repos = await git.scanAllRepos(targetRepoPath);
    db.refreshReposCache(repos);
    const cached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: cached });
  } catch (err) {
    console.error('[BackgroundScan] 自动更新失败:', err.message);
  } finally {
    isScanning = false;
  }
}

// ==================== API 路由 ====================

// --- 配置管理 ---
router.get('/config', async (ctx) => {
  ctx.body = { success: true, data: getConfig() };
});

router.post('/config', async (ctx) => {
  const body = ctx.request.body || {};

  // 1. 保存前数据合理性校验（目录是否存在、格式、权限等）
  const check = validateConfig(body);
  if (!check.valid) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: check.message || '配置数据校验未通过，请检查输入！',
    };
    return;
  }

  const prevConfig = getConfig();
  const updated = saveConfig(body);
  const pathChanged = prevConfig.targetRepoPath !== updated.targetRepoPath;
  const forceRefresh = Boolean(body.forceRefresh);

  let freshRepos = null;
  if (pathChanged || forceRefresh) {
    console.log(`[Config] 目标项目路径变更或要求重扫: ${prevConfig.targetRepoPath} -> ${updated.targetRepoPath}`);
    // 1. 数据库应该先清理
    db.clearCachedRepos();
    // 2. 然后刷新数据（物理扫描新路径）
    const scanned = await git.scanAllRepos(updated.targetRepoPath);
    // 3. 先落库
    db.refreshReposCache(scanned);
    // 4. 从数据库获取落库数据并返回前端
    freshRepos = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: freshRepos });
  }

  ctx.body = {
    success: true,
    data: updated,
    repos: freshRepos,
    message: pathChanged
      ? '项目路径已修改，数据库已清空并完成新数据落库！'
      : '配置已成功更新保存',
  };
});

// --- 仓库与分支大盘 (基于 SQLite 极速秒开) ---
router.get('/repos', async (ctx) => {
  const config = getConfig();
  const force = ctx.query.force === 'true';

  // 若非强制刷新，优先从 SQLite 缓存秒级响应 (<1ms)，绝不触发耗时的后台磁盘扫描
  if (!force) {
    const cached = db.getCachedRepos();
    if (cached && cached.length > 0) {
      ctx.body = { success: true, data: cached, source: 'sqlite' };
      return;
    }
  }

  // 强制物理扫描 -> 原子落库 SQLite 数据库 -> 从数据库返回前端
  const repos = await git.scanAllRepos(config.targetRepoPath);
  db.refreshReposCache(repos);
  const cached = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: cached });
  ctx.body = { success: true, data: cached, source: 'live' };
});

router.post('/git/fetch', async (ctx) => {
  const { repoPath } = ctx.request.body || {};
  const config = getConfig();
  if (repoPath) {
    const res = await git.fetchRepo(repoPath);
    // 重新扫描并原子落库，然后返回落库数据
    const scanned = await git.scanAllRepos(config.targetRepoPath);
    db.refreshReposCache(scanned);
    const cached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: cached });
    ctx.body = { ...res, repos: cached };
  } else {
    // 全局 fetch：从 SQLite 获取仓库列表并并发执行 git fetch -p
    const cached = db.getCachedRepos();
    const reposToFetch =
      cached && cached.length > 0
        ? cached
        : await git.scanAllRepos(config.targetRepoPath);

    await Promise.all(
      reposToFetch.filter((r) => r.isGit).map((r) => git.fetchRepo(r.path))
    );

    // 重新扫描、先落库、再把落库数据返回前端
    const scanned = await git.scanAllRepos(config.targetRepoPath);
    db.refreshReposCache(scanned);
    const freshCached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: freshCached });
    ctx.body = {
      success: true,
      data: freshCached,
      repos: freshCached,
      message: '已完成全部子仓库远程分支刷新并更新数据库！',
    };
  }
});

router.post('/git/checkout', async (ctx) => {
  const { repoPath, branch, force = false } = ctx.request.body || {};
  if (!repoPath || !branch) {
    ctx.throw(400, '缺少 repoPath 或 branch 参数');
  }
  const res = await git.checkoutRepo(repoPath, branch, { force });
  if (res.success) {
    db.updateRepoBranch(repoPath, branch);
    const cached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: cached });
    ctx.body = { ...res, repos: cached };
  } else {
    ctx.body = res;
  }
});

router.post('/git/batch-checkout', async (ctx) => {
  const { branch } = ctx.request.body || {};
  if (!branch) {
    ctx.throw(400, '缺少目标分支名称');
  }
  const config = getConfig();
  const results = await git.batchCheckoutAll(config.targetRepoPath, branch.trim());
  for (const r of results) {
    if (r.success) {
      db.updateRepoBranch(r.path, branch.trim());
    }
  }
  const cached = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: cached });
  ctx.body = { success: true, data: results, repos: cached };
});

router.post('/git/stash', async (ctx) => {
  const { repoPath } = ctx.request.body || {};
  if (!repoPath) ctx.throw(400, '缺少 repoPath 参数');
  const res = await git.stashRepo(repoPath);
  if (res.success) {
    const config = getConfig();
    const fresh = await git.scanAllRepos(config.targetRepoPath);
    db.refreshReposCache(fresh);
    const cached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: cached });
    ctx.body = { ...res, repos: cached };
    return;
  }
  ctx.body = res;
});

router.post('/git/reset', async (ctx) => {
  const { repoPath } = ctx.request.body || {};
  if (!repoPath) ctx.throw(400, '缺少 repoPath 参数');
  const res = await git.resetRepo(repoPath);
  if (res.success) {
    const config = getConfig();
    const fresh = await git.scanAllRepos(config.targetRepoPath);
    db.refreshReposCache(fresh);
    const cached = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: cached });
    ctx.body = { ...res, repos: cached };
    return;
  }
  ctx.body = res;
});

router.post('/git/prune', async (ctx) => {
  const { repoPath } = ctx.request.body || {};
  const config = getConfig();
  let resData;
  if (repoPath) {
    resData = await git.pruneBranches(repoPath, config.protectedBranches);
  } else {
    // 全量清理所有子仓
    const repos = await git.scanAllRepos(config.targetRepoPath);
    const summary = [];
    for (const r of repos) {
      if (r.isGit) {
        const pRes = await git.pruneBranches(r.path, config.protectedBranches);
        summary.push({ name: r.name, ...pRes });
      }
    }
    resData = summary;
  }
  // 先落库最新分支状态，再返回前端
  const freshRepos = await git.scanAllRepos(config.targetRepoPath);
  db.refreshReposCache(freshRepos);
  const cached = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: cached });
  ctx.body = {
    success: true,
    data: resData,
    repos: cached,
    message: '全局失效及已合并分支清理完毕并更新数据库',
  };
});

router.get('/git/local-branches', async (ctx) => {
  const { repoPath } = ctx.query;
  if (!repoPath) {
    ctx.throw(400, '缺少 repoPath 参数');
  }
  const config = getConfig();
  const data = await git.getLocalBranchesDetail(repoPath, config.protectedBranches);
  ctx.body = { success: true, data };
});

router.post('/git/delete-branches', async (ctx) => {
  const { repoPath, branches } = ctx.request.body || {};
  if (!repoPath || !Array.isArray(branches)) {
    ctx.throw(400, '缺少 repoPath 或 branches 数组');
  }
  const config = getConfig();
  const res = await git.deleteSpecificBranches(
    repoPath,
    branches,
    config.protectedBranches
  );
  // 删除分支后，重新扫描，落库更新并返回
  const freshRepos = await git.scanAllRepos(config.targetRepoPath);
  db.refreshReposCache(freshRepos);
  const cached = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: cached });
  ctx.body = { success: true, data: res, repos: cached };
});

// --- 构建调度 ---
router.post('/build', async (ctx) => {
  const config = getConfig();
  const {
    packages = [],
    mode = 'development',
    allowParallel = config.allowParallel,
    maxMemoryMb = config.maxMemoryMb,
    nodeVersion = config.selectedNodeVersion,
  } = ctx.request.body || {};

  const nodeBinPath = nvm.getNodeBinPath(nodeVersion);

  // 异步启动构建任务
  buildManager.buildPackages({
    targetRepoPath: config.targetRepoPath,
    packages,
    mode,
    allowParallel,
    maxMemoryMb,
    nodeBinPath,
  }).then(async (res) => {
    // 写入 SQLite 构建历史
    db.saveBuildRecord({
      packages,
      mode,
      status: res && res.success ? 'success' : 'failed',
      startTime: res?.startTime || Date.now(),
      durationSec: res?.durationSec || 0,
      nodeVersion,
      maxMemoryMb,
    });

    // 若开启了“构建成功后自动定向传输”
    if (res && res.success && config.autoDeployAfterBuild && config.deployTargets) {
      for (const [pkg, targetDir] of Object.entries(config.deployTargets)) {
        if (packages.length === 0 || packages.includes('all') || packages.includes(pkg)) {
          try {
            await sync.syncAppArtifacts(config.targetRepoPath, pkg, targetDir);
            buildManager.appendLog(`\x1b[32m[自动传输] 已同步 ${pkg} 至 ${targetDir}\x1b[0m\r\n`);
          } catch (err) {
            buildManager.appendLog(`\x1b[31m[自动传输失败] ${pkg}: ${err.message}\x1b[0m\r\n`);
          }
        }
      }
    }
  }).catch((err) => {
    console.error('[Build Manager Error]', err);
  });

  ctx.body = {
    success: true,
    message: '构建任务已成功加入调度执行，请通过控制台查看实时日志',
  };
});

router.get('/build/history', async (ctx) => {
  const limit = parseInt(ctx.query.limit || '20', 10);
  ctx.body = { success: true, data: db.getBuildHistory(limit) };
});

router.post('/build/abort', async (ctx) => {
  const ok = buildManager.abort();
  ctx.body = { success: ok, message: ok ? '任务已中止' : '当前无正在执行的任务' };
});

router.get('/build/status', async (ctx) => {
  ctx.body = {
    success: true,
    data: buildManager.getStatus(),
    logs: buildManager.getLogs(),
  };
});

// --- 环境与依赖清理 ---
router.post('/env/install', async (ctx) => {
  const config = getConfig();
  const { cleanLock = false, nodeVersion = config.selectedNodeVersion } = ctx.request.body || {};
  const nodeBinPath = nvm.getNodeBinPath(nodeVersion);

  buildManager.installDependencies(config.targetRepoPath, { cleanLock, nodeBinPath }).catch(() => {});
  ctx.body = { success: true, message: '依赖安装任务已启动' };
});

router.post('/env/clean-cache', async (ctx) => {
  const config = getConfig();
  const res = await buildManager.cleanBuildCaches(config.targetRepoPath);
  ctx.body = res;
});

router.post('/env/clean-modules', async (ctx) => {
  const config = getConfig();
  const res = await buildManager.cleanNodeModules(config.targetRepoPath);
  ctx.body = res;
});

// --- Node.js & pnpm 多版本管理 ---
router.get('/env/runtime', async (ctx) => {
  const nodeData = await nvm.getInstalledNodeVersions();
  const pnpmVer = await nvm.getCurrentPnpmVersion();
  ctx.body = {
    success: true,
    data: {
      ...nodeData,
      pnpmVersion: pnpmVer,
    },
  };
});

router.post('/env/node/install', async (ctx) => {
  const { version } = ctx.request.body || {};
  if (!version) ctx.throw(400, '缺少 Node 版本号');
  buildManager.clearLogs();
  buildManager.appendLog(`\x1b[36m>>> 开始执行 nvm install ${version} ...\x1b[0m\r\n`);
  const res = await nvm.installNodeVersion(version);
  if (res.success) {
    buildManager.appendLog(`\x1b[32m✔ Node ${version} 安装成功！\x1b[0m\r\n`);
  } else {
    buildManager.appendLog(`\x1b[31m✘ Node 安装失败: ${res.error}\x1b[0m\r\n`);
  }
  ctx.body = res;
});

router.post('/env/pnpm/install', async (ctx) => {
  const { version } = ctx.request.body || {};
  if (!version) ctx.throw(400, '缺少 pnpm 版本号');
  const res = await nvm.installPnpmVersion(version);
  ctx.body = res;
});

// --- 产物定向同步与下载 ---
router.post('/deploy/sync', async (ctx) => {
  const config = getConfig();
  const { appName, destinationPath } = ctx.request.body || {};
  if (!appName || !destinationPath) {
    ctx.throw(400, '缺少 appName 或 destinationPath 参数');
  }
  const res = await sync.syncAppArtifacts(config.targetRepoPath, appName, destinationPath);
  ctx.body = res;
});

router.get('/deploy/download/:app', async (ctx) => {
  const config = getConfig();
  const appName = ctx.params.app;
  const distDir = await sync.findDistDir(config.targetRepoPath, appName);

  if (!distDir) {
    ctx.throw(404, `未找到应用 ${appName} 的 dist 构建产物，请先执行打包！`);
  }

  const filename = `${appName}_dist_${Date.now()}.zip`;
  ctx.set('Content-Type', 'application/zip');
  ctx.set('Content-Disposition', `attachment; filename="${filename}"`);

  const zipStream = sync.createZipStream(distDir);
  ctx.body = zipStream;
});

// --- 实时内存监控 ---
router.get('/system/memory', async (ctx) => {
  const status = buildManager.getStatus();
  const mem = await monitor.getSystemMemory(status.pid);
  ctx.body = { success: true, data: mem };
});

app.use(router.routes()).use(router.allowedMethods());

// ==================== HTTP & WebSocket 整合 ====================

const config = getConfig();
const server = http.createServer(app.callback());
const wss = new WebSocketServer({ server, path: '/ws' });

// 广播工具
function broadcast(msgObj) {
  const payload = JSON.stringify(msgObj);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// 监听构建事件并推流
buildManager.on('log', (line) => {
  broadcast({ type: 'log', data: line });
});

buildManager.on('log_clear', () => {
  broadcast({ type: 'log_clear' });
});

buildManager.on('status_change', (status) => {
  broadcast({ type: 'build_status', data: status });
});

// WebSocket 客户端连接处理
wss.on('connection', (ws) => {
  // 发送初始构建状态与近期日志
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      status: buildManager.getStatus(),
      logs: buildManager.getLogs(),
    },
  }));
});

// 每 1.5 秒推流一次实时内存与系统负载
setInterval(async () => {
  if (wss.clients.size === 0) return;
  const buildStatus = buildManager.getStatus();
  const mem = await monitor.getSystemMemory(buildStatus.pid);
  broadcast({
    type: 'memory',
    data: mem,
  });
}, 1500);

const PORT = process.env.PORT || config.port || 9527;
const HOST = process.env.HOST || config.host || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log(`🚀 vben-build-dashboard 控制台服务已启动！`);
  console.log(`📡 监听地址: http://${HOST}:${PORT}`);
  console.log(`🌐 本地访问: http://localhost:${PORT}`);
  console.log(`📁 目标项目: ${config.targetRepoPath}`);
  console.log('====================================================');

  // SQLite 数据库缓存自检与预热
  try {
    const cached = db.getCachedRepos();
    if (!cached || cached.length === 0) {
      console.log('[SQLite] 缓存为空，开始执行首次后台预热扫描...');
      triggerBackgroundScan(config.targetRepoPath);
    } else {
      console.log(`[SQLite] 已从数据库加载 ${cached.length} 个子仓快照缓存`);
    }
  } catch (err) {
    console.warn('[SQLite] 数据库初始化提示:', err.message);
  }
});
