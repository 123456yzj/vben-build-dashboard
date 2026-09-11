import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { BuildStatus } from '../types.js';
import { errorMessage } from '../types.js';

type BuildState = BuildStatus['status'];

interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  title?: string;
}

interface BuildResult {
  success: boolean;
  duration?: string;
  code?: number | null;
  failedPackage?: string;
  error?: unknown;
}

export class BuildManager extends EventEmitter {
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private status: BuildState = 'idle';
  private currentTask: string | null = null;
  private startTime: number | null = null;
  private endTime: number | null = null;
  private logs: string[] = [];
  private readonly maxLogs = 2000;

  appendLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    this.emit('log', line);
  }

  clearLogs(): void {
    this.logs = [];
    this.emit('log_clear');
  }

  getStatus(): BuildStatus {
    return {
      status: this.status,
      currentTask: this.currentTask,
      startTime: this.startTime,
      endTime: this.endTime,
      pid: this.currentProcess?.pid ?? null,
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  abort(): boolean {
    if (!this.currentProcess) return false;
    try {
      const pid = this.currentProcess.pid;
      if (pid === undefined) return false;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/f', '/t']);
      else process.kill(-pid, 'SIGKILL');
      this.appendLog('\r\n\x1b[31;1m[系统] 用户已手动中止当前构建任务！\x1b[0m\r\n');
      this.status = 'failed';
      this.currentProcess = null;
      this.emit('status_change', this.getStatus());
      return true;
    } catch (error) {
      this.appendLog(`\r\n[系统] 中止任务失败: ${errorMessage(error)}\r\n`);
      return false;
    }
  }

  async runCommand(command: string, args: string[], { cwd, env = {}, title = '' }: CommandOptions): Promise<BuildResult> {
    if (this.status === 'running') throw new Error('当前已有正在执行的构建任务，请等待完成或先中止当前任务');
    this.clearLogs();
    this.status = 'running';
    this.currentTask = title || `${command} ${args.join(' ')}`;
    this.startTime = Date.now();
    this.endTime = null;
    this.emit('status_change', this.getStatus());
    this.appendLog(`\x1b[36;1m>>> 开始执行任务: ${this.currentTask}\x1b[0m\r\n`);
    this.appendLog(`\x1b[90m工作目录: ${cwd}\x1b[0m\r\n`);
    if (env.NODE_OPTIONS) this.appendLog(`\x1b[90m内存限额: ${env.NODE_OPTIONS}\x1b[0m\r\n`);
    this.appendLog('--------------------------------------------------\r\n');

    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const actualCommand = isWindows ? 'cmd.exe' : command;
      const actualArgs = isWindows ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`] : args;
      const child = spawn(actualCommand, actualArgs, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '1', ...env },
        shell: false,
        detached: !isWindows,
      });
      this.currentProcess = child;
      this.emit('status_change', this.getStatus());
      child.stdout.on('data', (data: Buffer) => this.appendLog(data.toString()));
      child.stderr.on('data', (data: Buffer) => this.appendLog(data.toString()));
      child.on('error', (error) => {
        this.appendLog(`\r\n\x1b[31;1m[进程异常] ${error.message}\x1b[0m\r\n`);
        this.status = 'failed';
        this.endTime = Date.now();
        this.currentProcess = null;
        this.emit('status_change', this.getStatus());
        reject(error);
      });
      child.on('close', (code) => {
        this.endTime = Date.now();
        const duration = (((this.endTime ?? Date.now()) - (this.startTime ?? Date.now())) / 1000).toFixed(2);
        this.currentProcess = null;
        if (code === 0) {
          this.status = 'success';
          this.appendLog(`\r\n\x1b[32;1m任务完成！耗时: ${duration}s\x1b[0m\r\n`);
          this.emit('status_change', this.getStatus());
          resolve({ success: true, duration });
        } else {
          this.status = 'failed';
          this.appendLog(`\r\n\x1b[31;1m任务失败 (退出码: ${code})，耗时: ${duration}s\x1b[0m\r\n`);
          this.emit('status_change', this.getStatus());
          resolve({ success: false, code, duration });
        }
      });
    });
  }

  async buildPackages({ targetRepoPath, packages = [] }: { targetRepoPath: string; packages?: string[] }): Promise<BuildResult> {
    if (this.status === 'running') throw new Error('当前已有正在执行的构建任务，请等待完成或先中止当前任务');
    const isAll = packages.length === 0 || packages.includes('all');
    if (isAll) return this.runCommand('pnpm', ['run', 'build:dev'], { cwd: targetRepoPath, title: '全量开发环境打包' });
    const scripts = packages.map((pkg) => `build:dev:${pkg.split('/').pop() ?? pkg}`);
    if (packages.length === 1) {
      return this.runCommand('pnpm', ['run', scripts[0] ?? ''], { cwd: targetRepoPath, title: `开发环境打包: ${packages[0] ?? ''}` });
    }

    this.clearLogs();
    this.status = 'running';
    this.currentTask = `依次执行开发环境打包: [${packages.join(', ')}]`;
    this.startTime = Date.now();
    this.endTime = null;
    this.emit('status_change', this.getStatus());
    this.appendLog('\x1b[36;1m>>> 开始执行开发环境打包队列\x1b[0m\r\n');
    for (let index = 0; index < packages.length; index += 1) {
      const packageName = packages[index] ?? '';
      this.appendLog(`\r\n\x1b[33;1m[队列 ${index + 1}/${packages.length}] 开始打包: ${packageName}\x1b[0m\r\n`);
      const result = await this.executeSubTask('pnpm', ['run', scripts[index] ?? ''], { cwd: targetRepoPath });
      if (!result.success) {
        this.status = 'failed';
        this.endTime = Date.now();
        this.emit('status_change', this.getStatus());
        this.appendLog(`\r\n\x1b[31;1m[构建队列中断] ${packageName} 构建失败，后续任务已终止。\x1b[0m\r\n`);
        return { success: false, failedPackage: packageName };
      }
    }
    this.status = 'success';
    this.endTime = Date.now();
    const duration = ((this.endTime - (this.startTime ?? this.endTime)) / 1000).toFixed(2);
    this.appendLog(`\r\n\x1b[32;1m开发环境打包队列完成！总耗时: ${duration}s\x1b[0m\r\n`);
    this.emit('status_change', this.getStatus());
    return { success: true, duration };
  }

  private executeSubTask(command: string, args: string[], { cwd, env = {} }: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<BuildResult> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const child = spawn(isWindows ? 'cmd.exe' : command, isWindows ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`] : args, {
        cwd, env: { ...process.env, FORCE_COLOR: '1', ...env }, shell: false,
      });
      this.currentProcess = child;
      child.stdout.on('data', (data: Buffer) => this.appendLog(data.toString()));
      child.stderr.on('data', (data: Buffer) => this.appendLog(data.toString()));
      child.on('close', (code) => { this.currentProcess = null; resolve({ success: code === 0, code }); });
      child.on('error', (error) => {
        this.appendLog(`\r\n\x1b[31;1m[错误] ${error.message}\x1b[0m\r\n`);
        this.currentProcess = null;
        resolve({ success: false, error });
      });
    });
  }
}

export const buildManager = new BuildManager();
