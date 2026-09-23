import { spawn } from 'node:child_process';

export type Output = (stream: 'stdout' | 'stderr', text: string) => void;

export function execute(command: string, args: string[], cwd: string, output?: Output, shell = false, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('构建已终止')); return; }
    const child = spawn(command, args, { cwd, shell, detached: !!signal && process.platform !== 'win32', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, windowsHide: true });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        killer.on('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
      }
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    let result = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      result = (result + text).slice(-65536);
      output?.('stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      result = (result + text).slice(-65536);
      output?.('stderr', text);
    });
    child.on('error', (error) => { signal?.removeEventListener('abort', stop); reject(error); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(new Error('构建已终止'));
      else if (code === 0) resolve(result.trim());
      else reject(new Error(result.trim() || `${command} exited with code ${code}`));
    });
  });
}
