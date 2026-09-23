import type { FastifyInstance } from 'fastify';
import { runGitAction } from '../git.js';
import { projectByName, type Project } from '../projects.js';
import type { registerSocket } from '../websocket/socket.js';

export function registerGitRoute(app: FastifyInstance, projects: Project[], busy: Set<string>, { publish, outputFor }: ReturnType<typeof registerSocket>): void {
  app.post<{ Params: { name: string }; Body: { action?: string; branch?: string } }>('/api/projects/:name/git', async (request, reply) => {
    const project = projectByName(projects, request.params.name);
    const { action, branch } = request.body || {};
    if (action !== 'fetch' && action !== 'pull' && action !== 'checkout') return reply.code(400).send({ error: '无效的 Git 操作' });
    if (busy.has(project.name)) return reply.code(409).send({ error: '项目正在执行操作' });
    try {
      const git = await runGitAction(project, action, branch, busy, outputFor(project.name, 'git'), publish);
      return { git };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Git 操作失败' });
    }
  });
}
