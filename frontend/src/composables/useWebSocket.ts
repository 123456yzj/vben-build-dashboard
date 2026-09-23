import { ref } from 'vue';
import type { BuildTask } from '../types/build';
import type { GitInfo } from '../types/git';

export interface SocketMessage {
  type: string;
  workspace: string;
  repository?: string;
  task?: BuildTask;
  git?: GitInfo;
  busy?: boolean;
  stream?: string;
  text?: string;
  buildId?: string;
}

export function useWebSocket(onMessage: (message: SocketMessage) => void, onConnected: () => void) {
  const connected = ref(false);
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.onopen = () => { connected.value = true; onConnected(); };
    socket.onclose = () => { connected.value = false; reconnectTimer = setTimeout(connect, 2000); };
    socket.onmessage = (event: MessageEvent<string>) => onMessage(JSON.parse(event.data) as SocketMessage);
  }
  function disconnect() {
    clearTimeout(reconnectTimer);
    if (socket) { socket.onclose = null; socket.close(); }
  }
  return { connected, connect, disconnect };
}
