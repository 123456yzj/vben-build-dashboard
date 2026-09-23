import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'vben-control-smoke-'));
const repo = path.join(root, 'repo');
let child;
let socket;

function git(...args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
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
  await mkdir(repo);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Smoke Test');
  git('config', 'user.email', 'smoke@example.invalid');
  await writeFile(path.join(repo, 'README.md'), 'test\n');
  git('add', '.');
  git('commit', '-m', 'Initial commit');
  git('branch', 'feature');

  const config = path.join(root, 'projects.json');
  await writeFile(config, JSON.stringify({ projects: [{ name: 'demo', path: repo, buildCommand: 'node -e "console.log(\'BUILD_SMOKE\')"' }] }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['dist/server.js'], {
    cwd: agentRoot,
    env: { ...process.env, PORT: String(port), PROJECTS_FILE: config, HISTORY_FILE: path.join(root, 'history.json'), STATIC_DIR: path.resolve(agentRoot, '../frontend/dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });

  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(serverOutput);
    try { return (await fetch(`${base}/api/projects`)).ok; } catch { return false; }
  });

  async function api(url, options) {
    const response = await fetch(`${base}${url}`, options);
    return { status: response.status, body: await response.json() };
  }

  const list = await api('/api/projects');
  assert.equal(list.body[0].name, 'demo');
  assert.equal(list.body[0].git.branch, 'main');
  const detail = await api('/api/projects/demo');
  assert.deepEqual(detail.body.history, []);
  assert.deepEqual(detail.body.logs, []);
  assert.equal(detail.body.busy, false);
  assert.equal((await api('/api/projects/missing')).status, 404);

  const events = [];
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  socket.addEventListener('message', (event) => events.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const headers = { 'Content-Type': 'application/json' };
  assert.equal((await api('/api/projects/demo/git', { method: 'POST', headers, body: JSON.stringify({ action: 'invalid' }) })).status, 400);
  const switched = await api('/api/projects/demo/git', { method: 'POST', headers, body: JSON.stringify({ action: 'checkout', branch: 'feature' }) });
  assert.equal(switched.body.git.branch, 'feature');
  assert.equal((await api('/api/projects/demo')).body.git.branch, 'feature');
  await waitFor(() => events.some((event) => event.type === 'git' && event.git.branch === 'feature'));

  const started = await api('/api/projects/demo/build', { method: 'POST' });
  assert.equal(started.status, 202);
  assert.equal(started.body.branch, 'feature');
  const finished = await waitFor(async () => {
    const response = await api('/api/projects/demo');
    return response.body.history[0]?.status === 'success' && response.body.logs.some((log) => log.text.includes('BUILD_SMOKE')) && response.body;
  });
  assert.equal(finished.history[0].id, started.body.id);
  assert.equal((await api('/api/projects')).body[0].latestBuild.status, 'success');
  await waitFor(() => events.some((event) => event.type === 'log' && event.text.includes('BUILD_SMOKE')));
  assert.equal(events.some((event) => event.type === 'busy' && event.busy === true), true);
  assert.equal((await fetch(`${base}/projects/demo`)).headers.get('content-type')?.includes('text/html'), true);
  console.log('Smoke test passed: list, detail, Git, WebSocket logs, Build, history, static route');
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
