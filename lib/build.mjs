import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class BuildManager extends EventEmitter {
  constructor() {
    super();
    this.currentProcess = null;
    this.status = 'idle'; // 'idle' | 'running' | 'success' | 'failed'
    this.currentTask = null;
    this.startTime = null;
    this.endTime = null;
    this.logs = []; // in-memory recent logs for re-joining clients
    this.maxLogs = 2000;
  }

  appendLog(line) {
    this.logs.push(line);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', line);
  }

  clearLogs() {
    this.logs = [];
    this.emit('log_clear');
  }

  getStatus() {
    return {
      status: this.status,
      currentTask: this.currentTask,
      startTime: this.startTime,
      endTime: this.endTime,
      pid: this.currentProcess ? this.currentProcess.pid : null,
    };
  }

  getLogs() {
    return this.logs;
  }

  abort() {
    if (this.currentProcess) {
      try {
        // Kill process tree
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', this.currentProcess.pid.toString(), '/f', '/t']);
        } else {
          process.kill(-this.currentProcess.pid, 'SIGKILL');
        }
        this.appendLog('\r\n\x1b[31;1m[系统] 用户已手动中止当前构建任务！\x1b[0m\r\n');
        this.status = 'failed';
        this.currentProcess = null;
        this.emit('status_change', this.getStatus());
        return true;
      } catch (err) {
        this.appendLog(`\r\n[系统] 中止任务失败: ${err.message}\r\n`);
        return false;
      }
    }
    return false;
  }

  async runCommand(cmd, args, { cwd, env = {}, title = '' }) {
    if (this.status === 'running') {
      throw new Error('当前已有正在执行的构建任务，请等待完成或先中止当前任务');
    }

    this.clearLogs();
    this.status = 'running';
    this.currentTask = title || `${cmd} ${args.join(' ')}`;
    this.startTime = Date.now();
    this.endTime = null;
    this.emit('status_change', this.getStatus());

    this.appendLog(`\x1b[36;1m>>> 开始执行任务: ${this.currentTask}\x1b[0m\r\n`);
    this.appendLog(`\x1b[90m工作目录: ${cwd}\x1b[0m\r\n`);
    if (env.NODE_OPTIONS) {
      this.appendLog(`\x1b[90m内存限额: ${env.NODE_OPTIONS}\x1b[0m\r\n`);
    }
    this.appendLog(`--------------------------------------------------\r\n`);

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const actualCmd = isWin ? 'cmd.exe' : cmd;
      const actualArgs = isWin ? ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`] : args;

      const mergedEnv = {
        ...process.env,
        FORCE_COLOR: '1',
        ...env,
      };

      const child = spawn(actualCmd, actualArgs, {
        cwd,
        env: mergedEnv,
        shell: false,
        detached: !isWin,
      });

      this.currentProcess = child;
      this.emit('status_change', this.getStatus());

      child.stdout.on('data', (data) => {
        this.appendLog(data.toString());
      });

      child.stderr.on('data', (data) => {
        this.appendLog(data.toString());
      });

      child.on('error', (err) => {
        this.appendLog(`\r\n\x1b[31;1m[进程异常] ${err.message}\x1b[0m\r\n`);
        this.status = 'failed';
        this.endTime = Date.now();
        this.currentProcess = null;
        this.emit('status_change', this.getStatus());
        reject(err);
      });

      child.on('close', (code) => {
        this.endTime = Date.now();
        const durationSec = ((this.endTime - this.startTime) / 1000).toFixed(2);
        this.currentProcess = null;

        if (code === 0) {
          this.status = 'success';
          this.appendLog(`\r\n\x1b[32;1m✔ 任务完成！耗时: ${durationSec}s\x1b[0m\r\n`);
          this.emit('status_change', this.getStatus());
          resolve({ success: true, duration: durationSec });
        } else {
          this.status = 'failed';
          this.appendLog(`\r\n\x1b[31;1m✘ 任务失败 (退出码: ${code})，耗时: ${durationSec}s\x1b[0m\r\n`);
          this.emit('status_change', this.getStatus());
          resolve({ success: false, code, duration: durationSec });
        }
      });
    });
  }

  // 1. 打包指定包或全量包
  async buildPackages({ targetRepoPath, packages = [], mode = 'development', allowParallel = true, maxMemoryMb = 8192, nodeBinPath = '' }) {
    const env = {
      NODE_OPTIONS: `--max-old-space-size=${maxMemoryMb}`,
      NODE_ENV: mode,
      MODE: mode,
    };

    if (nodeBinPath) {
      env.PATH = `${nodeBinPath}${path.delimiter}${process.env.PATH}`;
    }

    const isAll = packages.length === 0 || packages.includes('all');

    if (isAll) {
      const modeFlag = mode === 'development' ? '-- --mode development' : '';
      return this.runCommand('pnpm', ['run', 'build', modeFlag].filter(Boolean), {
        cwd: targetRepoPath,
        env,
        title: `全量打包 (全应用，模式: ${mode})`,
      });
    }

    // 单个包
    if (packages.length === 1) {
      const pkg = packages[0];
      const filterArg = `--filter=${pkg}`;
      const modeFlag = mode === 'development' ? '--mode development' : '';
      const args = ['run', 'build', filterArg];
      if (modeFlag) {
        args.push('--', modeFlag);
      }
      return this.runCommand('pnpm', args, {
        cwd: targetRepoPath,
        env,
        title: `打包应用: ${pkg} (模式: ${mode})`,
      });
    }

    // 多个包：根据 allowParallel 区分
    if (allowParallel) {
      // Turbo 并行多 filter
      const filterArgs = packages.map(p => `--filter=${p}`);
      const modeFlag = mode === 'development' ? '--mode development' : '';
      const args = ['run', 'build', ...filterArgs];
      if (modeFlag) {
        args.push('--', modeFlag);
      }
      return this.runCommand('pnpm', args, {
        cwd: targetRepoPath,
        env,
        title: `并行打包多个应用: [${packages.join(', ')}]`,
      });
    } else {
      // 串行队列构建
      this.clearLogs();
      this.status = 'running';
      this.currentTask = `串行排队打包: [${packages.join(', ')}]`;
      this.startTime = Date.now();
      this.endTime = null;
      this.emit('status_change', this.getStatus());

      this.appendLog(`\x1b[36;1m>>> 开始串行排队打包应用列表 (防OOM平稳模式)\x1b[0m\r\n`);
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        this.appendLog(`\r\n\x1b[33;1m[队列 ${i + 1}/${packages.length}] 开始打包: ${pkg}\x1b[0m\r\n`);
        const filterArg = `--filter=${pkg}`;
        const modeFlag = mode === 'development' ? '--mode development' : '';
        const args = ['run', 'build', filterArg];
        if (modeFlag) {
          args.push('--', modeFlag);
        }

        // Sub step execution
        const res = await this.executeSubTask('pnpm', args, { cwd: targetRepoPath, env });
        if (!res.success) {
          this.status = 'failed';
          this.endTime = Date.now();
          this.emit('status_change', this.getStatus());
          this.appendLog(`\r\n\x1b[31;1m[串行队列中断] ${pkg} 构建失败，后续排队任务已终止。\x1b[0m\r\n`);
          return { success: false, failedPackage: pkg };
        }
      }

      this.status = 'success';
      this.endTime = Date.now();
      const totalDuration = ((this.endTime - this.startTime) / 1000).toFixed(2);
      this.appendLog(`\r\n\x1b[32;1m✔ 串行排队打包全部完成！总耗时: ${totalDuration}s\x1b[0m\r\n`);
      this.emit('status_change', this.getStatus());
      return { success: true, duration: totalDuration };
    }
  }

  // 辅助串行执行单个子任务
  executeSubTask(cmd, args, { cwd, env }) {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const actualCmd = isWin ? 'cmd.exe' : cmd;
      const actualArgs = isWin ? ['/d', '/s', '/c', `${cmd} ${args.join(' ')}`] : args;

      const child = spawn(actualCmd, actualArgs, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '1', ...env },
        shell: false,
      });

      this.currentProcess = child;

      child.stdout.on('data', (d) => this.appendLog(d.toString()));
      child.stderr.on('data', (d) => this.appendLog(d.toString()));
      child.on('close', (code) => {
        this.currentProcess = null;
        resolve({ success: code === 0, code });
      });
      child.on('error', (err) => {
        this.appendLog(`\r\n\x1b[31;1m[错误] ${err.message}\x1b[0m\r\n`);
        this.currentProcess = null;
        resolve({ success: false, error: err });
      });
    });
  }

  // 2. 依赖管理
  async installDependencies(targetRepoPath, { cleanLock = false, nodeBinPath = '' } = {}) {
    const env = {};
    if (nodeBinPath) {
      env.PATH = `${nodeBinPath}${path.delimiter}${process.env.PATH}`;
    }

    if (cleanLock) {
      const lockPath = path.join(targetRepoPath, 'pnpm-lock.yaml');
      try {
        await fs.unlink(lockPath);
        this.appendLog('[系统] 已删除 pnpm-lock.yaml，准备全量纯净重装...\r\n');
      } catch {}
      return this.runCommand('pnpm', ['install', '--no-frozen-lockfile'], {
        cwd: targetRepoPath,
        env,
        title: '深度全量重新安装依赖 (pnpm install --no-frozen-lockfile)',
      });
    }

    return this.runCommand('pnpm', ['install'], {
      cwd: targetRepoPath,
      env,
      title: '常规安装依赖 (pnpm install)',
    });
  }

  // 3. 缓存清理
  async cleanBuildCaches(targetRepoPath) {
    this.clearLogs();
    this.appendLog('\x1b[36;1m>>> 开始清理构建缓存与构建产物...\x1b[0m\r\n');

    const targets = [];
    // 根目录缓存
    targets.push(path.join(targetRepoPath, '.turbo'));
    targets.push(path.join(targetRepoPath, 'node_modules', '.vite'));

    // 子包缓存与产物
    const appsDir = path.join(targetRepoPath, 'apps');
    try {
      const entries = await fs.readdir(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subAppDir = path.join(appsDir, entry.name);
          targets.push(path.join(subAppDir, 'dist'));
          targets.push(path.join(subAppDir, '.turbo'));
          targets.push(path.join(subAppDir, 'node_modules', '.vite'));
        }
      }
    } catch {}

    let cleanedCount = 0;
    for (const t of targets) {
      try {
        await fs.rm(t, { recursive: true, force: true });
        this.appendLog(`✔ 已清理: ${path.relative(targetRepoPath, t)}\r\n`);
        cleanedCount++;
      } catch (err) {
        // ignore not found
      }
    }

    this.appendLog(`\r\n\x1b[32;1m✔ 缓存清理完毕！共清理 ${cleanedCount} 处缓存与产物目录。\x1b[0m\r\n`);
    return { success: true, count: cleanedCount };
  }

  // 4. 深度清理 node_modules
  async cleanNodeModules(targetRepoPath) {
    this.clearLogs();
    this.appendLog('\x1b[31;1m>>> 开始彻底清理所有 node_modules 目录...\x1b[0m\r\n');

    const targets = [path.join(targetRepoPath, 'node_modules')];
    const appsDir = path.join(targetRepoPath, 'apps');
    try {
      const entries = await fs.readdir(appsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          targets.push(path.join(appsDir, entry.name, 'node_modules'));
        }
      }
    } catch {}

    for (const t of targets) {
      try {
        this.appendLog(`正在清理: ${t} ...\r\n`);
        await fs.rm(t, { recursive: true, force: true });
      } catch (err) {}
    }

    this.appendLog('\r\n\x1b[32;1m✔ 全部 node_modules 清理完毕！后续请点击【安装依赖】重建环境。\x1b[0m\r\n');
    return { success: true };
  }
}

export const buildManager = new BuildManager();
