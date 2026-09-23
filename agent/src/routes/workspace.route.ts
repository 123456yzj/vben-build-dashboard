import type { FastifyInstance } from 'fastify';
import { getGitStatus } from '../git.js';
import { repositoryCommand, type BuildStore } from '../builds.js';
import type { OperationLocks } from '../locks.js';
import { RepositoryScanner, workspaceByName, type Workspace } from '../workspaces.js';

export function registerWorkspaceRoutes(app: FastifyInstance, workspaces: Workspace[], scanner: RepositoryScanner, store: BuildStore, locks: OperationLocks): void {
  app.get('/api/workspaces', async () => workspaces.map(({ name, path, repositoryDir, depth }) => ({ name, path, repositoryDir, depth })));
  app.get<{ Params: { workspace: string } }>('/api/workspaces/:workspace', async (request) => {
    const workspace = workspaceByName(workspaces, request.params.workspace);
    return { name: workspace.name, path: workspace.path, repositoryDir: workspace.repositoryDir, depth: workspace.depth,
      build: { all: workspace.build.all }, busy: locks.isBusy(workspace.name) };
  });
  app.get<{ Params: { workspace: string }; Querystring: { refresh?: string } }>('/api/workspaces/:workspace/repositories', async (request) => {
    const workspace = workspaceByName(workspaces, request.params.workspace);
    const repositories = await scanner.list(workspace, request.query.refresh === 'true');
    return Promise.all(repositories.map(async (repository) => {
      let buildable = true;
      try { repositoryCommand(workspace, repository); } catch { buildable = false; }
      try { return { ...repository, git: await getGitStatus(repository), busy: locks.isBusy(workspace.name, repository.name), buildable }; }
      catch (error) { return { ...repository, git: null, busy: locks.isBusy(workspace.name, repository.name), buildable, error: (error as Error).message }; }
    }));
  });
  app.get<{ Params: { workspace: string; repository: string } }>('/api/workspaces/:workspace/repositories/:repository', async (request) => {
    const workspace = workspaceByName(workspaces, request.params.workspace);
    const repository = await scanner.find(workspace, request.params.repository);
    return { ...repository, git: await getGitStatus(repository), busy: locks.isBusy(workspace.name, repository.name) };
  });
  app.get<{ Params: { workspace: string } }>('/api/workspaces/:workspace/builds', async (request) => store.list(workspaceByName(workspaces, request.params.workspace).name));
}
