import type { FastifyInstance } from 'fastify';
import { runGitAction } from '../git.js';
import type { OperationLocks } from '../locks.js';
import { RepositoryScanner, workspaceByName, type Workspace } from '../workspaces.js';
import type { registerSocket } from '../websocket/socket.js';

export function registerGitRoute(app: FastifyInstance, workspaces: Workspace[], scanner: RepositoryScanner, locks: OperationLocks,
  { publish, outputFor }: ReturnType<typeof registerSocket>): void {
  app.post<{ Params: { workspace: string; repository: string }; Body: { action?: string; branch?: string } }>(
    '/api/workspaces/:workspace/repositories/:repository/git', async (request, reply) => {
      const workspace = workspaceByName(workspaces, request.params.workspace);
      const { action, branch } = request.body || {};
      if (action !== 'fetch' && action !== 'pull' && action !== 'checkout') return reply.code(400).send({ error: '无效的 Git 操作' });
      if (branch !== undefined && typeof branch !== 'string') return reply.code(400).send({ error: '无效的分支' });
      const repository = await scanner.find(workspace, request.params.repository);
      const release = locks.acquire(workspace.name, [repository.name]);
      publish({ type: 'busy', workspace: workspace.name, repository: repository.name, busy: true });
      try { return { git: await runGitAction(repository, action, branch, outputFor(workspace.name, repository.name, 'git'), publish) }; }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Git 操作失败' }); }
      finally {
        release();
        publish({ type: 'busy', workspace: workspace.name, repository: repository.name, busy: false });
      }
    });
}
