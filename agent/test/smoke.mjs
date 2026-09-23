import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryBuildScript, workspaceBuildScripts } from '../dist/builds.js';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'vben-workspace-smoke-'));
const app = path.join(root, 'app');
let child;
let socket;

function git(repo, ...args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
async function addRepo(name) {
  const repo = path.join(app, name);
  await mkdir(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Smoke Test');
  git(repo, 'config', 'user.email', 'smoke@example.invalid');
  await writeFile(path.join(repo, 'README.md'), 'test\n');
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: `@repo/${path.basename(name)}`, scripts: { 'build:dev': 'node -e "process.exit(4)"' } }));
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial commit');
  git(repo, 'branch', 'feature');
  return repo;
}
async function waitFor(check, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for agent state');
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

try {
  await mkdir(app);
  const tms = await addRepo('tms');
  await addRepo('oms');
  await addRepo('crm');
  await addRepo(path.join('group', 'nested'));
  const workspace = {
    name: 'vben', path: root, repositoryDir: 'app', depth: 1,
  };
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'main-workspace', scripts: {
    'build:dev': "node -e \"if(process.env.TURBO_FORCE!=='true')process.exit(5);console.log('ALL_SMOKE')\"",
    'build:dev:tms': "node -e \"if(process.env.TURBO_FORCE!=='true')process.exit(5);console.log('TMS_SMOKE')\"",
    'build:dev:oms': "node -e \"console.log('OMS_FORCE_'+process.env.TURBO_FORCE);process.exit(3)\"",
    'build:dev:crm': "node -e \"if(process.env.TURBO_FORCE!=='true')process.exit(5);console.log('CRM_STARTED'); setTimeout(() => require('fs').writeFileSync('cancel-marker', 'late'), 2000)\"",
  } }));
  const cache = path.join(root, '.turbo', 'cache');
  await mkdir(cache, { recursive: true });
  await mkdir(path.join(root, '.turbo', 'preferences'));
  await writeFile(path.join(root, '.turbo', 'preferences', 'tui.json'), '{}');
  async function cacheEntry(hash, output) {
    await writeFile(path.join(cache, `${hash}-manifest.json`), JSON.stringify({ files: { [output]: {} } }));
    await writeFile(path.join(cache, `${hash}-meta.json`), '{}');
    await writeFile(path.join(cache, `${hash}.tar.zst`), 'archive');
  }
  await cacheEntry('aaaaaaaaaaaaaaaa', 'app/tms/dist/index.js');
  await cacheEntry('bbbbbbbbbbbbbbbb', 'app/oms/dist/index.js');
  await cacheEntry('cccccccccccccccc', 'app/crm/dist/index.js');
  await cacheEntry('dddddddddddddddd', 'packages/shared/dist/index.js');
  await cacheEntry('eeeeeeeeeeeeeeee', 'app/tms-other/dist/index.js');
  assert.equal(await repositoryBuildScript({ workspace: 'vben', name: 'tms', path: tms }, await workspaceBuildScripts(workspace)), 'build:dev:tms');
  const config = path.join(root, 'workspaces.json');
  await writeFile(config, JSON.stringify({ workspaces: [workspace] }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['dist/server.js'], {
    cwd: agentRoot,
    env: { ...process.env, PORT: String(port), WORKSPACES_FILE: config, HISTORY_FILE: path.join(root, 'tasks.json'), STATIC_DIR: path.resolve(agentRoot, '../frontend/dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${base}/api/workspaces`)).ok; } catch { return false; }
  });
  async function api(url, options) {
    const response = await fetch(`${base}${url}`, options);
    return { status: response.status, body: await response.json() };
  }
  const headers = { 'Content-Type': 'application/json' };
  const post = (url, body) => api(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const builds = '/api/workspaces/vben/builds';
  const gitUrl = '/api/workspaces/vben/repositories/tms/git';
  assert.equal((await api('/api/workspaces')).body[0].name, 'vben');
  const list = (await api('/api/workspaces/vben/repositories')).body;
  assert.deepEqual(list.map((item) => item.name), ['crm', 'oms', 'tms']);
  assert.equal(list[2].git.branch, 'main');
  assert.equal(list[2].buildScript, 'build:dev:tms');
  assert.equal((await api('/api/workspaces/missing')).status, 404);

  const events = [];
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  socket.addEventListener('message', (event) => events.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  assert.equal((await post(gitUrl, { action: 'invalid' })).status, 400);
  const switched = await post(gitUrl, { action: 'checkout', branch: 'feature' });
  assert.equal(switched.body.git.branch, 'feature');
  await waitFor(() => events.some((event) => event.type === 'git' && event.repository === 'tms' && event.git.branch === 'feature'));

  await writeFile(path.join(tms, 'dirty.txt'), 'dirty');
  assert.equal((await post(gitUrl, { action: 'checkout', branch: 'main' })).status, 409);
  assert.equal((await post(gitUrl, { action: 'pull' })).status, 409);
  assert.equal((await post(builds, { scope: 'repositories', repositories: ['tms'] })).status, 409);
  assert.equal((await post(builds, { scope: 'all' })).status, 409);
  assert.equal(existsSync(path.join(cache, 'aaaaaaaaaaaaaaaa.tar.zst')), true);
  git(tms, 'add', 'dirty.txt');
  git(tms, 'commit', '-m', 'Clean');

  assert.equal((await post(builds, { scope: 'repositories', repositories: ['missing'] })).status, 400);
  assert.equal((await post(builds, { scope: 'repositories', repositories: ['tms', 'tms'] })).status, 400);
  assert.equal((await post(builds, { scope: 'all', command: 'node -e "process.exit(0)"' })).status, 400);
  const started = await post(builds, { scope: 'repositories', repositories: ['tms', 'oms', 'crm'] });
  assert.equal(started.status, 202);
  const failed = await waitFor(async () => {
    const result = (await api(`${builds}/${started.body.id}`)).body;
    return result.status === 'failed' && result;
  });
  assert.deepEqual(failed.steps.map((step) => step.status), ['success', 'failed', 'pending']);
  for (const hash of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) {
    for (const suffix of ['-manifest.json', '-meta.json', '.tar.zst']) assert.equal(existsSync(path.join(cache, `${hash}${suffix}`)), false);
  }
  for (const hash of ['cccccccccccccccc', 'dddddddddddddddd', 'eeeeeeeeeeeeeeee']) assert.equal(existsSync(path.join(cache, `${hash}.tar.zst`)), true);
  assert(failed.logs.some((log) => log.text.includes('TMS_SMOKE')));
  assert(failed.logs.some((log) => log.text.includes('OMS_FORCE_true')));
  assert(failed.logs.some((log) => log.repository === 'tms' && log.text.includes('TMS_SMOKE') && log.time && log.sequence));
  assert(failed.logs.every((log, index) => index === 0 || log.sequence > failed.logs[index - 1].sequence));
  assert(failed.logs.some((log) => log.repository === 'oms' && log.text.includes('Build failed')));
  assert(events.some((event) => event.type === 'log' && event.buildId === started.body.id && event.repository === 'tms' && event.text.includes('TMS_SMOKE') && event.sequence && event.time));
  assert(!failed.logs.some((log) => log.text.includes('CRM_SMOKE')));
  const all = await post(builds, { scope: 'all' });
  assert.equal(all.status, 202);
  const finished = await waitFor(async () => {
    const result = (await api(`${builds}/${all.body.id}`)).body;
    return result.status === 'success' && result;
  });
  assert(finished.logs.some((log) => log.text.includes('ALL_SMOKE')));
  assert.equal(existsSync(cache), false);
  assert.equal(existsSync(path.join(root, '.turbo', 'preferences', 'tui.json')), true);
  assert(finished.logs.every((log) => log.repository === null));
  assert.equal((await api(builds)).body.length, 2);
  assert(events.some((event) => event.type === 'log' && event.buildId === all.body.id));
  await addRepo('new-business');
  const refreshed = (await api('/api/workspaces/vben/repositories?refresh=true')).body;
  assert.equal(refreshed.find((repo) => repo.name === 'new-business').buildable, false);
  assert.equal((await post(builds, { scope: 'repositories', repositories: ['new-business'] })).status, 400);
  assert.equal((await post(`${builds}/${all.body.id}/cancel`, {})).status, 409);
  assert.equal((await post(`${builds}/missing/cancel`, {})).status, 404);
  const cancellable = await post(builds, { scope: 'repositories', repositories: ['crm', 'tms'] });
  assert.equal(cancellable.status, 202);
  await waitFor(async () => (await api(`${builds}/${cancellable.body.id}`)).body.logs.some((log) => log.text.includes('CRM_STARTED')));
  const cancelled = await api(`${builds}/${cancellable.body.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.deepEqual(cancelled.body.steps.map((step) => step.status), ['cancelled', 'pending']);
  assert.equal((await post(`${builds}/${cancellable.body.id}/cancel`, {})).status, 409);
  assert(events.some((event) => event.type === 'build' && event.task?.id === cancellable.body.id && event.task.status === 'cancelled'));
  const afterCancel = await post(builds, { scope: 'repositories', repositories: ['tms'] });
  assert.equal(afterCancel.status, 202);
  await waitFor(async () => (await api(`${builds}/${afterCancel.body.id}`)).body.status === 'success');
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.equal(existsSync(path.join(root, 'cancel-marker')), false, 'cancel must stop the child process tree');
  assert((await fetch(`${base}/workspaces/vben`)).headers.get('content-type')?.includes('text/html'));
  console.log('Smoke test passed: scan, Git safety, targeted Turbo cache cleanup, forced builds, cancellation and lock release');
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
