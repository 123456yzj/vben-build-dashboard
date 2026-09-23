import type { FastifyInstance } from 'fastify';

export interface BuildLog { stream: string; text: string; buildId: string; repository: string | null; time: string; sequence: number }

export function registerSocket(app: FastifyInstance) {
  const sockets = new Set<{ send: (value: string) => void; readyState: number }>();
  const logs = new Map<string, BuildLog[]>();

  function publish(event: object): void {
    const data = JSON.stringify(event);
    for (const socket of sockets) if (socket.readyState === 1) socket.send(data);
  }

  function outputFor(workspace: string, buildId: string, repository: string | null) {
    return (stream: 'stdout' | 'stderr', text: string) => {
      const list = logs.get(buildId) || [];
      const sequence = (list.at(-1)?.sequence || 0) + 1;
      const log = { stream, text: text.slice(-65536), buildId, repository, time: new Date().toISOString(), sequence };
      list.push(log);
      if (list.length > 2000) list.splice(0, list.length - 2000);
      logs.set(buildId, list);
      publish({ type: 'log', workspace, ...log });
    };
  }

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return { logs, publish, outputFor };
}
