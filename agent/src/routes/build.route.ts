import type { FastifyInstance } from 'fastify';
import { checkClean, repositoryCommand, runBuild, type BuildStore } from '../builds.js';
import type { OperationLocks } from '../locks.js';
import { RepositoryScanner, workspaceByName, type Workspace } from '../workspaces.js';
import type { registerSocket } from '../websocket/socket.js';

export function registerBuildRoute(app: FastifyInstance, workspaces: Workspace[], scanner: RepositoryScanner, store: BuildStore,
  locks: OperationLocks, { logs, publish, outputFor }: ReturnType<typeof registerSocket>): void {
  app.post<{ Params: { workspace: string }; Body: { scope?: string; repositories?: unknown } }>('/api/workspaces/:workspace/builds', async (request, reply) => {
    const workspace = workspaceByName(workspaces, request.params.workspace);
    const { scope, repositories: names } = request.body || {};
    if (scope !== 'all' && scope !== 'repositories') return reply.code(400).send({ error: '无效的构建范围' });
    if (scope === 'all' && names !== undefined) return reply.code(400).send({ error: '全量构建不能指定仓库' });
    if (scope === 'repositories' && (!Array.isArray(names) || !names.length ||
      !names.every((name) => typeof name === 'string') || new Set(names).size !== names.length)) {
      return reply.code(400).send({ error: '请选择不重复的业务仓库' });
    }
    const discovered = await scanner.list(workspace, true);
    const repositories = scope === 'all' ? discovered : (names as string[]).map((name) => discovered.find((repo) => repo.name === name));
    if (!repositories.length || repositories.some((repo) => !repo)) return reply.code(400).send({ error: '构建目标不存在或为空' });
    const targets = repositories.filter((repo) => repo !== undefined);
    for (const repository of targets) await scanner.find(workspace, repository.name);
    if (scope === 'repositories') targets.forEach((repository) => repositoryCommand(workspace, repository));
    const release = locks.acquire(workspace.name, targets.map((repo) => repo.name), scope === 'all');
    try {
      const branches = await checkClean(targets);
      const task = await store.create(workspace, scope, targets, branches);
      logs.set(task.id, []);
      publish({ type: 'build', workspace: workspace.name, task });
      void runBuild(workspace, targets, task, store, outputFor(workspace.name, task.id), publish)
        .catch((error) => app.log.error(error))
        .finally(() => { release(); publish({ type: 'busy', workspace: workspace.name, busy: false }); });
      return reply.code(202).send(task);
    } catch (error) { release(); throw error; }
  });
  app.get<{ Params: { workspace: string; id: string } }>('/api/workspaces/:workspace/builds/:id', async (request) => {
    const workspace = workspaceByName(workspaces, request.params.workspace);
    return { ...store.get(workspace.name, request.params.id), logs: logs.get(request.params.id) || [] };
  });
}
