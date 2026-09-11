import { execFileSync } from 'node:child_process';
import net from 'node:net';

function getWslIp(): string {
  try {
    const output = execFileSync('wsl', ['-d', 'Ubuntu-22.04', 'ip', '-4', 'addr', 'show', 'eth0'], { encoding: 'utf8' });
    return output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

const wslIp = getWslIp();
console.log(`[Bridge] 发现 WSL IP: ${wslIp}`);

const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect(9527, wslIp);
  clientSocket.pipe(targetSocket);
  targetSocket.pipe(clientSocket);
  clientSocket.on('error', () => targetSocket.destroy());
  targetSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('close', () => targetSocket.end());
  targetSocket.on('close', () => clientSocket.end());
});

server.listen(9527, () => {
  console.log('====================================================');
  console.log('vben-build-dashboard Windows 桥接服务已就绪！');
  console.log('本地访问: http://localhost:9527/ 或 http://127.0.0.1:9527/');
  console.log(`目标 WSL: http://${wslIp}:9527/`);
  console.log('====================================================');
});
