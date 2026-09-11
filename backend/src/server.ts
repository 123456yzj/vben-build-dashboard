import Router from '@koa/router';
import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import { WebSocket, WebSocketServer } from 'ws';

import { buildManager } from './lib/build.js';
import { getConfig, normalizeRepoPath, saveConfig, validateConfig } from './lib/config.js';
import * as db from './lib/db.js';
import * as git from './lib/git.js';
import type { BuildStatus, GitResult, WebSocketMessage } from './types.js';
import { errorMessage, isRecord } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');
const repoRootDir = path.resolve(backendDir, '..');
const app = new Koa();
const router = new Router({ prefix: '/api' });

function bodyOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function statusOf(error: unknown): number {
  return isRecord(error) && typeof error.status === 'number' ? error.status : 500;
}

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[Error] ${ctx.method} ${ctx.url} - ${message}`);
    ctx.status = statusOf(error);
    ctx.body = { success: false, message: message || '内部服务器错误' };
  }
});

app.use(bodyParser());

function resolveStaticDir(): string {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR;
  const frontendDist = path.join(repoRootDir, 'frontend', 'dist');
  if (existsSync(frontendDist)) return frontendDist;
  const rootDist = path.join(repoRootDir, 'dist');
  return existsSync(rootDist) ? rootDist : frontendDist;
}

const staticDir = resolveStaticDir();
app.use(serve(staticDir));
app.use(async (ctx, next) => {
  await next();
  if (ctx.status === 404 && ctx.method === 'GET' && !ctx.path.startsWith('/api') && !ctx.path.startsWith('/ws')) {
    const indexPath = path.join(staticDir, 'index.html');
    if (existsSync(indexPath)) {
      ctx.type = 'html';
      ctx.body = await fs.readFile(indexPath, 'utf-8');
    }
  }
});

let isScanning = false;
async function triggerBackgroundScan(targetRepoPath: string): Promise<void> {
  if (isScanning) return;
  isScanning = true;
  try {
    db.refreshReposCache(await git.scanAllRepos(targetRepoPath));
    broadcast({ type: 'repos_updated', data: db.getCachedRepos() });
  } catch (error) {
    console.error('[BackgroundScan] 自动更新失败:', errorMessage(error));
  } finally {
    isScanning = false;
  }
}

router.get('/config', (ctx) => {
  ctx.body = { success: true, data: getConfig() };
});

router.get('/fs/directories', async (ctx) => {
  const requestedPath = typeof ctx.query.path === 'string' ? ctx.query.path.trim() : '';
  if (process.platform === 'win32' && !requestedPath) {
    const drives = await Promise.all(Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`).map(async (drivePath) => {
      try {
        await fs.access(drivePath);
        return { name: drivePath, path: drivePath };
      } catch {
        return null;
      }
    }));
    ctx.body = { success: true, data: { currentPath: '', parentPath: null, directories: drives.filter((drive) => drive !== null), isProject: false } };
    return;
  }

  const nativeResolvedPath = requestedPath ? path.resolve(requestedPath) : '';
  const isNativeRoot = Boolean(nativeResolvedPath) && nativeResolvedPath === path.parse(nativeResolvedPath).root;
  const normalizedPath = requestedPath
    ? (isNativeRoot ? nativeResolvedPath : normalizeRepoPath(requestedPath))
    : path.parse(process.cwd()).root;
  const currentPath = path.resolve(normalizedPath);
  let stats;
  try {
    stats = await fs.stat(currentPath);
  } catch {
    ctx.throw(400, `目录不存在或无法访问: ${currentPath}`);
    return;
  }
  if (!stats.isDirectory()) ctx.throw(400, `目标路径不是目录: ${currentPath}`);
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(currentPath, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  const projectMarkers = await Promise.all(['package.json', '.git'].map(async (name) => {
    try { await fs.access(path.join(currentPath, name)); return true; } catch { return false; }
  }));
  const rootPath = path.parse(currentPath).root;
  ctx.body = {
    success: true,
    data: {
      currentPath,
      parentPath: currentPath === rootPath ? (process.platform === 'win32' ? '' : null) : path.dirname(currentPath),
      directories,
      isProject: projectMarkers.some(Boolean),
    },
  };
});

router.post('/config/validate', (ctx) => {
  const check = validateConfig(ctx.request.body);
  ctx.body = {
    success: true,
    valid: check.valid,
    field: check.field ?? null,
    message: check.message ?? (check.valid ? '校验通过' : '校验未通过'),
  };
});

router.post('/config', async (ctx) => {
  const body = bodyOf(ctx.request.body);
  const check = validateConfig(body);
  if (!check.valid) {
    ctx.status = 400;
    ctx.body = { success: false, field: check.field ?? null, message: check.message ?? '配置数据校验未通过，请检查输入！' };
    return;
  }
  const previous = getConfig();
  const updated = saveConfig(body);
  const pathChanged = normalizeRepoPath(previous.targetRepoPath) !== normalizeRepoPath(updated.targetRepoPath);
  const forceRefresh = Boolean(body.forceRefresh);
  let freshRepos = null;
  if (pathChanged || forceRefresh) {
    console.log(`[Config] 目标项目路径变更或要求重扫: ${previous.targetRepoPath} -> ${updated.targetRepoPath}`);
    db.clearCachedRepos();
    db.refreshReposCache(await git.scanAllRepos(updated.targetRepoPath));
    freshRepos = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: freshRepos });
  }
  ctx.body = {
    success: true, data: updated, repos: freshRepos,
    message: pathChanged ? '项目路径已修改，数据库已清空并完成新数据落库！' : '配置已成功更新保存',
  };
});

router.get('/repos', async (ctx) => {
  const config = getConfig();
  if (ctx.query.force !== 'true') {
    const cached = db.getCachedRepos();
    if (cached.length > 0) {
      ctx.body = { success: true, data: cached, source: 'sqlite' };
      return;
    }
  }
  db.refreshReposCache(await git.scanAllRepos(config.targetRepoPath));
  const cached = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: cached });
  ctx.body = { success: true, data: cached, source: 'live' };
});

router.post('/git/fetch', async (ctx) => {
  const repoPath = stringValue(bodyOf(ctx.request.body).repoPath);
  const config = getConfig();
  if (repoPath) {
    const result = await git.fetchRepo(repoPath);
    db.refreshReposCache(await git.scanAllRepos(config.targetRepoPath));
    const repos = db.getCachedRepos();
    broadcast({ type: 'repos_updated', data: repos });
    ctx.body = { ...result, repos };
    return;
  }
  const cached = db.getCachedRepos();
  const reposToFetch = cached.length > 0 ? cached : await git.scanAllRepos(config.targetRepoPath);
  await Promise.all(reposToFetch.filter((repo) => repo.isGit).map((repo) => git.fetchRepo(repo.path)));
  db.refreshReposCache(await git.scanAllRepos(config.targetRepoPath));
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { success: true, data: repos, repos, message: '已完成全部子仓库远程分支刷新并更新数据库！' };
});

router.post('/git/checkout', async (ctx) => {
  const body = bodyOf(ctx.request.body);
  const repoPath = stringValue(body.repoPath);
  const branch = stringValue(body.branch);
  if (!repoPath || !branch) {
    ctx.throw(400, '缺少 repoPath 或 branch 参数');
    return;
  }
  const result = await git.checkoutRepo(repoPath, branch, { force: body.force === true });
  if (!result.success) { ctx.body = result; return; }
  db.updateRepoBranch(repoPath, branch);
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { ...result, repos };
});

router.post('/git/batch-checkout', async (ctx) => {
  const branch = stringValue(bodyOf(ctx.request.body).branch);
  if (!branch) {
    ctx.throw(400, '缺少目标分支名称');
    return;
  }
  const normalizedBranch = branch.trim();
  const results = await git.batchCheckoutAll(getConfig().targetRepoPath, normalizedBranch);
  for (const result of results) if (result.success) db.updateRepoBranch(result.path, normalizedBranch);
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { success: true, data: results, repos };
});

async function handleRepoMutation(ctx: Router.RouterContext, action: (repoPath: string) => Promise<GitResult>): Promise<void> {
  const repoPath = stringValue(bodyOf(ctx.request.body).repoPath);
  if (!repoPath) {
    ctx.throw(400, '缺少 repoPath 参数');
    return;
  }
  const result = await action(repoPath);
  if (!result.success) { ctx.body = result; return; }
  db.refreshReposCache(await git.scanAllRepos(getConfig().targetRepoPath));
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { ...result, repos };
}

router.post('/git/stash', (ctx) => handleRepoMutation(ctx, git.stashRepo));
router.post('/git/reset', (ctx) => handleRepoMutation(ctx, git.resetRepo));

router.post('/git/prune', async (ctx) => {
  const repoPath = stringValue(bodyOf(ctx.request.body).repoPath);
  const config = getConfig();
  let data: unknown;
  if (repoPath) data = await git.pruneBranches(repoPath, config.protectedBranches);
  else {
    const summary = [];
    for (const repo of await git.scanAllRepos(config.targetRepoPath)) {
      if (repo.isGit) summary.push({ name: repo.name, ...await git.pruneBranches(repo.path, config.protectedBranches) });
    }
    data = summary;
  }
  db.refreshReposCache(await git.scanAllRepos(config.targetRepoPath));
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { success: true, data, repos, message: '全局失效及已合并分支清理完毕并更新数据库' };
});

router.get('/git/local-branches', async (ctx) => {
  const repoPath = typeof ctx.query.repoPath === 'string' ? ctx.query.repoPath : undefined;
  if (!repoPath) {
    ctx.throw(400, '缺少 repoPath 参数');
    return;
  }
  ctx.body = { success: true, data: await git.getLocalBranchesDetail(repoPath, getConfig().protectedBranches) };
});

router.post('/git/delete-branches', async (ctx) => {
  const body = bodyOf(ctx.request.body);
  const repoPath = stringValue(body.repoPath);
  const branches = Array.isArray(body.branches) && body.branches.every((branch) => typeof branch === 'string') ? body.branches : undefined;
  if (!repoPath || !branches) {
    ctx.throw(400, '缺少 repoPath 或 branches 数组');
    return;
  }
  const result = await git.deleteSpecificBranches(repoPath, branches, getConfig().protectedBranches);
  db.refreshReposCache(await git.scanAllRepos(getConfig().targetRepoPath));
  const repos = db.getCachedRepos();
  broadcast({ type: 'repos_updated', data: repos });
  ctx.body = { success: true, data: result, repos };
});

router.post('/build', (ctx) => {
  const body = bodyOf(ctx.request.body);
  const mode = typeof body.mode === 'string' ? body.mode : 'development';
  const packages = Array.isArray(body.packages) && body.packages.every((item) => typeof item === 'string') ? body.packages : [];
  if (mode !== 'development') ctx.throw(400, '当前系统仅支持 development 环境构建');
  if (buildManager.getStatus().status === 'running') ctx.throw(409, '当前已有正在执行的构建任务');
  void buildManager.buildPackages({ targetRepoPath: getConfig().targetRepoPath, packages }).catch((error: unknown) => {
    console.error('[Build Manager Error]', errorMessage(error));
  });
  ctx.body = { success: true, message: '构建任务已成功加入调度执行，请通过控制台查看实时日志' };
});

router.post('/build/abort', (ctx) => {
  const success = buildManager.abort();
  ctx.body = { success, message: success ? '任务已中止' : '当前无正在执行的任务' };
});

router.get('/build/status', (ctx) => {
  ctx.body = { success: true, data: buildManager.getStatus(), logs: buildManager.getLogs() };
});

app.use(router.routes()).use(router.allowedMethods());
const config = getConfig();
const server = http.createServer(app.callback());
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(message: WebSocketMessage): void {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
}

buildManager.on('log', (line: string) => broadcast({ type: 'log', data: line }));
buildManager.on('log_clear', () => broadcast({ type: 'log_clear' }));
buildManager.on('status_change', (status: BuildStatus) => broadcast({ type: 'build_status', data: status }));

wss.on('connection', (socket) => {
  const message: WebSocketMessage = { type: 'init', data: { status: buildManager.getStatus(), logs: buildManager.getLogs() } };
  socket.send(JSON.stringify(message));
});

const port = process.env.PORT ? Number(process.env.PORT) : config.port || 9527;
const host = process.env.HOST || config.host || '0.0.0.0';
server.listen(port, host, () => {
  console.log('====================================================');
  console.log('vben-build-dashboard 控制台服务已启动！');
  console.log(`监听地址: http://${host}:${port}`);
  console.log(`本地访问: http://localhost:${port}`);
  console.log(`目标项目: ${config.targetRepoPath}`);
  console.log('====================================================');
  try {
    const cached = db.getCachedRepos();
    if (cached.length === 0) {
      console.log('[SQLite] 缓存为空，开始执行首次后台预热扫描...');
      void triggerBackgroundScan(config.targetRepoPath);
    } else console.log(`[SQLite] 已从数据库加载 ${cached.length} 个子仓快照缓存`);
  } catch (error) {
    console.warn('[SQLite] 数据库初始化提示:', errorMessage(error));
  }
});
