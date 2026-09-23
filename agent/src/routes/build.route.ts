import type { FastifyInstance } from 'fastify';
import { startBuild, type BuildStore } from '../builds.js';
import { projectByName, type Project } from '../projects.js';
import type { registerSocket } from '../websocket/socket.js';

export function registerBuildRoute(app: FastifyInstance, projects: Project[], store: BuildStore, busy: Set<string>, { logs, publish, outputFor }: ReturnType<typeof registerSocket>): void {
  app.post<{ Params: { name: string } }>('/api/projects/:name/build', async (request, reply) => {
    const project = projectByName(projects, request.params.name);
    if (busy.has(project.name)) return reply.code(409).send({ error: '项目正在执行操作' });
    const record = await startBuild(project, store, busy, logs, outputFor, publish, (error) => app.log.error(error));
    return reply.code(202).send(record);
  });
}
