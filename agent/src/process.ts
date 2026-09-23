import { spawn } from 'node:child_process';

export type Output = (stream: 'stdout' | 'stderr', text: string) => void;

export function execute(command: string, args: string[], cwd: string, output?: Output, shell = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
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
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(result.trim()) : reject(new Error(result.trim() || `${command} exited with code ${code}`)));
  });
}
