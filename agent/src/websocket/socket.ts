import type { FastifyInstance } from 'fastify';

export function registerSocket(app: FastifyInstance) {
  const sockets = new Set<{ send: (value: string) => void; readyState: number }>();
  const logs = new Map<string, { stream: string; text: string; buildId: string }[]>();

  function publish(event: object): void {
    const data = JSON.stringify(event);
    for (const socket of sockets) if (socket.readyState === 1) socket.send(data);
  }

  function outputFor(workspace: string, buildId: string, repository?: string) {
    return (stream: 'stdout' | 'stderr', text: string) => {
      const list = logs.get(buildId) || [];
      list.push({ stream, text: text.slice(-65536), buildId });
      if (list.length > 2000) list.splice(0, list.length - 2000);
      logs.set(buildId, list);
      publish({ type: 'log', workspace, repository, buildId, stream, text });
    };
  }

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return { logs, publish, outputFor };
}
