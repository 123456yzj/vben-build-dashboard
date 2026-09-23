import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildStore } from './builds.js';
import { loadWorkspaces, RepositoryScanner } from './workspaces.js';
import { OperationLocks } from './locks.js';
import { registerWorkspaceRoutes } from './routes/workspace.route.js';
import { registerGitRoute } from './routes/git.route.js';
import { registerBuildRoute } from './routes/build.route.js';
import { registerSocket } from './websocket/socket.js';

const app = Fastify({ logger: true });
const workspaces = await loadWorkspaces();
const scanner = new RepositoryScanner();
for (const workspace of workspaces) await scanner.list(workspace, true);
const store = new BuildStore(process.env.HISTORY_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/build-tasks.json'));
await store.init();
const locks = new OperationLocks();

await app.register(websocket);
const socket = registerSocket(app);
registerWorkspaceRoutes(app, workspaces, scanner, store, locks);
registerGitRoute(app, workspaces, scanner, locks, socket);
registerBuildRoute(app, workspaces, scanner, store, locks, socket);

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
