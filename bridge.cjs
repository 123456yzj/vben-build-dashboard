const net = require('node:net');
const cp = require('node:child_process');

function getWslIp() {
  try {
    const out = cp.execSync('wsl -d Ubuntu-22.04 ip -4 addr show eth0', { encoding: 'utf8' });
    const match = out.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    return match ? match[1] : '127.0.0.1';
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

  clientSocket.on('error', () => {});
  targetSocket.on('error', () => {});
});

server.listen(9527, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('🚀 vben-build-dashboard Windows 桥接服务已就绪！');
  console.log('🌐 本地访问: http://localhost:9527/ 或 http://127.0.0.1:9527/');
  console.log(`📡 目标 WSL: http://${wslIp}:9527/`);
  console.log('====================================================');
});
