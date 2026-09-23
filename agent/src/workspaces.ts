import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CommandSpec { command: string; args: string[] }
export interface Workspace {
  name: string;
  path: string;
  repositoryDir: string;
  depth: number;
  build: { all: CommandSpec; repositories: Record<string, CommandSpec> };
}
export interface Repository { workspace: string; name: string; path: string }

function commandSpec(value: unknown): CommandSpec {
  if (!value || typeof value !== 'object' || !('command' in value) || !('args' in value) ||
    typeof value.command !== 'string' || !value.command.trim() ||
    !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string')) {
    throw new Error('Build commands require a program name and string args array');
  }
  return { command: value.command, args: value.args as string[] };
}

export async function loadWorkspaces(file = process.env.WORKSPACES_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/workspaces.json')): Promise<Workspace[]> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('workspaces' in parsed) || !Array.isArray(parsed.workspaces)) {
    throw new Error('workspaces.json must contain a workspaces array');
  }
  const names = new Set<string>();
  return parsed.workspaces.map((value: unknown) => {
    if (!value || typeof value !== 'object' || !('name' in value) || !('path' in value) ||
      typeof value.name !== 'string' || !value.name.trim() || names.has(value.name) ||
      typeof value.path !== 'string' || !path.isAbsolute(value.path)) throw new Error('Workspace needs a unique name and absolute path');
    const item = value as Record<string, unknown>;
    const repositoryDir = item.repositoryDir === undefined ? 'app' : item.repositoryDir;
    const depth = item.depth === undefined ? 1 : item.depth;
    if (typeof repositoryDir !== 'string' || !repositoryDir || path.isAbsolute(repositoryDir) ||
      repositoryDir.split(/[\\/]/).some((part) => !part || part === '.' || part === '..') ||
      !Number.isInteger(depth) || (depth as number) < 1 || (depth as number) > 5) {
      throw new Error('repositoryDir must stay inside the Workspace and depth must be 1..5');
    }
    const build = item.build;
    if (!build || typeof build !== 'object' || !('all' in build)) throw new Error('Workspace build.all is required');
    const overrides = 'repositories' in build ? build.repositories : {};
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('build.repositories must be an object');
    const repositories: Record<string, CommandSpec> = Object.create(null);
    for (const [name, command] of Object.entries(overrides)) {
      if (!name || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid repository override name');
      repositories[name] = commandSpec(command);
    }
    names.add(value.name);
    return { name: value.name, path: value.path, repositoryDir, depth: depth as number,
      build: { all: commandSpec(build.all), repositories } };
  });
}

export function workspaceByName(workspaces: Workspace[], name: string): Workspace {
  const workspace = workspaces.find((item) => item.name === name);
  if (!workspace) throw Object.assign(new Error('Workspace 不存在'), { statusCode: 404 });
  return workspace;
}

export class RepositoryScanner {
  private cache = new Map<string, { time: number; repositories: Repository[] }>();

  async list(workspace: Workspace, refresh = false): Promise<Repository[]> {
    const cached = this.cache.get(workspace.name);
    if (!refresh && cached && Date.now() - cached.time < 10000) return cached.repositories;
    const base = await realpath(path.join(workspace.path, workspace.repositoryDir));
    const root = await realpath(workspace.path);
    if (!base.startsWith(root + path.sep)) throw new Error('扫描目录超出 Workspace');
    const repositories: Repository[] = [];
    const visit = async (dir: string, prefix: string, remaining: number): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const location = path.join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        try {
          const marker = await lstat(path.join(location, '.git'));
          if (marker.isDirectory() || marker.isFile()) {
            repositories.push({ workspace: workspace.name, name, path: location });
            continue;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (remaining > 1) await visit(location, name, remaining - 1);
      }
    };
    await visit(base, '', workspace.depth);
    repositories.sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(workspace.name, { time: Date.now(), repositories });
    return repositories;
  }

  async find(workspace: Workspace, name: string): Promise<Repository> {
    const repository = (await this.list(workspace, true)).find((item) => item.name === name);
    if (!repository) throw Object.assign(new Error('Repository 不存在'), { statusCode: 404 });
    const base = await realpath(path.join(workspace.path, workspace.repositoryDir));
    const actual = await realpath(repository.path);
    if (!actual.startsWith(base + path.sep)) throw Object.assign(new Error('仓库路径超出扫描目录'), { statusCode: 400 });
    return repository;
  }
}
