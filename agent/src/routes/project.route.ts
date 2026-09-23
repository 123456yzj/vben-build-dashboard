import type { FastifyInstance } from 'fastify';
import { getGitStatus } from '../git.js';
import { projectByName, type Project } from '../projects.js';
import type { BuildStore } from '../builds.js';
import type { registerSocket } from '../websocket/socket.js';

export function registerProjectRoutes(app: FastifyInstance, projects: Project[], store: BuildStore, busy: Set<string>, { logs }: ReturnType<typeof registerSocket>): void {
  app.get('/api/projects', async () => Promise.all(projects.map(async (project) => {
    try {
      return { ...project, git: await getGitStatus(project), latestBuild: store.list(project.name)[0] || null };
    } catch (error) {
      return { ...project, git: null, latestBuild: store.list(project.name)[0] || null, error: (error as Error).message };
    }
  })));

  app.get<{ Params: { name: string } }>('/api/projects/:name', async (request) => {
    const project = projectByName(projects, request.params.name);
    return { ...project, git: await getGitStatus(project), history: store.list(project.name), busy: busy.has(project.name), logs: logs.get(project.name) || [] };
  });
}
