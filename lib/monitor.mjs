import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function getProcessMemoryMb(pid) {
  if (!pid) return 0;

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
      const match = stdout.match(/"([^"]+)"/g);
      if (match && match.length >= 5) {
        // e.g. "54,320 K"
        const memStr = match[4].replace(/["\s,Kk]/g, '');
        const kb = parseInt(memStr, 10);
        return isNaN(kb) ? 0 : Math.round(kb / 1024);
      }
      return 0;
    } else {
      // Linux /proc/[pid]/statm or ps
      const { stdout } = await execAsync(`ps -o rss= -p ${pid}`);
      const kb = parseInt(stdout.trim(), 10);
      return isNaN(kb) ? 0 : Math.round(kb / 1024);
    }
  } catch {
    return 0;
  }
}

export async function getSystemMemory(pid = null) {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  const totalMb = Math.round(total / (1024 * 1024));
  const usedMb = Math.round(used / (1024 * 1024));
  const freeMb = Math.round(free / (1024 * 1024));
  const percent = Number(((used / total) * 100).toFixed(1));

  let processRssMb = 0;
  if (pid) {
    processRssMb = await getProcessMemoryMb(pid);
  }

  return {
    totalMb,
    usedMb,
    freeMb,
    percent,
    processRssMb,
    uptimeSec: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
  };
}
