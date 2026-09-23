import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repository, Workspace } from './workspaces.js';
import { execute, type Output } from './process.js';
import { getGitStatus } from './git.js';

export type BuildState = 'pending' | 'running' | 'success' | 'failed';
export interface BuildStep { repository: string | null; branch: string; status: BuildState; duration: number | null }
export interface BuildTask {
  id: string;
  workspace: string;
  scope: 'all' | 'repositories';
  repositories: string[];
  time: string;
  status: BuildState;
  duration: number | null;
  steps: BuildStep[];
}

export class BuildStore {
  private records: BuildTask[] = [];
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('build history must be an array');
      this.records = parsed as BuildTask[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const task of this.records) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'failed';
        for (const step of task.steps) if (step.status === 'running' || step.status === 'pending') step.status = 'failed';
      }
    }
    await this.persist();
  }

  list(workspace: string): BuildTask[] { return this.records.filter((task) => task.workspace === workspace); }
  get(workspace: string, id: string): BuildTask {
    const task = this.list(workspace).find((item) => item.id === id);
    if (!task) throw Object.assign(new Error('构建任务不存在'), { statusCode: 404 });
    return task;
  }
  async create(workspace: Workspace, scope: BuildTask['scope'], repositories: Repository[], branches: string[]): Promise<BuildTask> {
    const task: BuildTask = { id: randomUUID(), workspace: workspace.name, scope, repositories: repositories.map((repo) => repo.name),
      time: new Date().toISOString(), status: 'pending', duration: null,
      steps: scope === 'all' ? [{ repository: null, branch: branches.join(', '), status: 'pending', duration: null }] :
        repositories.map((repo, index) => ({ repository: repo.name, branch: branches[index]!, status: 'pending', duration: null })) };
    this.records.unshift(task);
    this.records = this.records.slice(0, 100);
    await this.persist();
    return task;
  }
  async save(): Promise<void> { await this.persist(); }

  private persist(): Promise<void> {
    const save = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(this.records, null, 2) + '\n');
      await rename(temp, this.file);
    };
    this.writes = this.writes.then(save);
    return this.writes;
  }
}

export async function workspaceBuildScripts(workspace: Workspace): Promise<Set<string>> {
  const parsed: unknown = JSON.parse(await readFile(path.join(workspace.path, 'package.json'), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('scripts' in parsed) || !parsed.scripts ||
    typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) throw new Error('主工程 package.json 缺少 scripts');
  return new Set(Object.entries(parsed.scripts).filter(([name, value]) =>
    /^build:dev(?::[a-zA-Z0-9_-]+)?$/.test(name) && typeof value === 'string' && value.trim()).map(([name]) => name));
}

export function allBuildScript(scripts: Set<string>): string {
  if (!scripts.has('build:dev')) throw Object.assign(new Error('主工程未配置 build:dev 脚本'), { statusCode: 400 });
  return 'build:dev';
}

export async function repositoryBuildScript(repository: Repository, scripts: Set<string>): Promise<string> {
  const candidates = [path.basename(repository.path)];
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(repository.path, 'package.json'), 'utf8'));
    if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof parsed.name === 'string') {
      candidates.push(parsed.name.split('/').at(-1)!);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const name of candidates) {
    if (/^[a-zA-Z0-9_-]+$/.test(name) && scripts.has(`build:dev:${name}`)) return `build:dev:${name}`;
  }
  throw Object.assign(new Error(`主工程没有匹配 ${repository.name} 的 dev 构建脚本`), { statusCode: 400 });
}

export async function checkClean(repositories: Repository[]): Promise<string[]> {
  const branches: string[] = [];
  for (const repository of repositories) {
    const git = await getGitStatus(repository);
    if (!git.clean) throw Object.assign(new Error(`仓库 ${repository.name} 有未提交改动，禁止构建`), { statusCode: 409 });
    branches.push(git.branch);
  }
  return branches;
}

export async function runBuild(workspace: Workspace, scripts: string[], task: BuildTask, store: BuildStore,
  output: Output, publish: (event: object) => void): Promise<void> {
  const notify = () => publish({ type: 'build', workspace: workspace.name, task: { ...task, steps: task.steps.map((step) => ({ ...step })) } });
  try {
    task.status = 'running';
    await store.save();
    notify();
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i]!;
      const script = scripts[i]!;
      step.status = 'running';
      await store.save();
      notify();
      const started = Date.now();
      output('stdout', `\n$ pnpm run ${script} (${step.repository || workspace.name})\n`);
      try {
        await execute('pnpm', ['run', script], workspace.path, output);
        step.status = 'success';
      } catch (error) {
        step.status = 'failed';
        task.status = 'failed';
        output('stderr', `\nBuild failed: ${(error as Error).message.slice(-300)}\n`);
      }
      step.duration = Date.now() - started;
      await store.save();
      notify();
      if (task.status === 'failed') break;
    }
    if (task.status !== 'failed') task.status = 'success';
  } catch (error) {
    task.status = 'failed';
    output('stderr', `\nBuild failed: ${(error as Error).message.slice(-300)}\n`);
  } finally {
    task.duration = Date.now() - Date.parse(task.time);
    await store.save();
    notify();
  }
}
