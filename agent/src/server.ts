import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildStore, runBuild } from './builds.js';
import { getGitStatus, gitAction } from './git.js';
import { loadProjects } from './projects.js';

const app = Fastify({ logger: true });
const projects = await loadProjects();
const store = new BuildStore(process.env.HISTORY_FILE || path.resolve('data/build-history.json'));
await store.init();
const busy = new Set<string>();
const sockets = new Set<{ send: (value: string) => void; readyState: number }>();
const logs = new Map<string, { stream: string; text: string; buildId: string }[]>();

function publish(event: object): void {
  const data = JSON.stringify(event);
  for (const socket of sockets) if (socket.readyState === 1) socket.send(data);
}

function projectByName(name: string) {
  const project = projects.find((item) => item.name === name);
  if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
  return project;
}

function outputFor(project: string, buildId: string) {
  return (stream: 'stdout' | 'stderr', text: string) => {
    const list = logs.get(project) || [];
    list.push({ stream, text: text.slice(-65536), buildId });
    if (list.length > 2000) list.splice(0, list.length - 2000);
    logs.set(project, list);
    publish({ type: 'log', project, buildId, stream, text });
  };
}

await app.register(websocket);
app.get('/ws', { websocket: true }, (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

app.get('/api/projects', async () => Promise.all(projects.map(async (project) => {
  try {
    return { ...project, git: await getGitStatus(project), latestBuild: store.list(project.name)[0] || null };
  } catch (error) {
    return { ...project, git: null, latestBuild: store.list(project.name)[0] || null, error: (error as Error).message };
  }
})));

app.get<{ Params: { name: string } }>('/api/projects/:name', async (request) => {
  const project = projectByName(request.params.name);
  return { ...project, git: await getGitStatus(project), history: store.list(project.name), busy: busy.has(project.name), logs: logs.get(project.name) || [] };
});

app.post<{ Params: { name: string }; Body: { action?: string; branch?: string } }>('/api/projects/:name/git', async (request, reply) => {
  const project = projectByName(request.params.name);
  const { action, branch } = request.body || {};
  if (action !== 'fetch' && action !== 'pull' && action !== 'checkout') return reply.code(400).send({ error: '无效的 Git 操作' });
  if (busy.has(project.name)) return reply.code(409).send({ error: '项目正在执行操作' });
  busy.add(project.name);
  publish({ type: 'busy', project: project.name, busy: true });
  try {
    await gitAction(project, action, branch, outputFor(project.name, 'git'));
    const git = await getGitStatus(project);
    publish({ type: 'git', project: project.name, git });
    return { git };
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : 'Git 操作失败' });
  } finally {
    busy.delete(project.name);
    publish({ type: 'busy', project: project.name, busy: false });
  }
});

app.post<{ Params: { name: string } }>('/api/projects/:name/build', async (request, reply) => {
  const project = projectByName(request.params.name);
  if (busy.has(project.name)) return reply.code(409).send({ error: '项目正在执行操作' });
  busy.add(project.name);
  try {
    const record = await store.create(project);
    logs.set(project.name, []);
    publish({ type: 'build', project: project.name, record });
    publish({ type: 'busy', project: project.name, busy: true });
    void runBuild(project, record, store, outputFor(project.name, record.id), () => publish({ type: 'build', project: project.name, record }))
      .catch((error: unknown) => app.log.error(error))
      .finally(() => {
        busy.delete(project.name);
        publish({ type: 'busy', project: project.name, busy: false });
      });
    return reply.code(202).send(record);
  } catch (error) {
    busy.delete(project.name);
    throw error;
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  reply.code(status >= 400 ? status : 500).send({ error: error instanceof Error ? error.message : 'Internal error' });
});

const staticDir = process.env.STATIC_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (existsSync(staticDir)) await app.register(fastifyStatic, { root: staticDir, wildcard: false });
app.setNotFoundHandler((request, reply) => {
  if (existsSync(staticDir) && request.method === 'GET' && !request.url.startsWith('/api/') && request.url !== '/ws') return reply.sendFile('index.html');
  return reply.code(404).send({ error: 'Not found' });
});

await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 9527) });
