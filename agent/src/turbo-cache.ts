import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Repository, Workspace } from './workspaces.js';

const artifactSuffixes = ['-manifest.json', '-meta.json', '.tar.zst'];

export async function clearTurboCache(workspace: Workspace, repository: Repository | null, signal: AbortSignal): Promise<number> {
  if (signal.aborted) throw new Error('构建已终止');
  const turboDir = path.join(workspace.path, '.turbo');
  const cacheDir = path.join(turboDir, 'cache');
  try {
    for (const directory of [turboDir, cacheDir]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Turbo 缓存路径不是普通目录: ${directory}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  if (!repository) {
    if (signal.aborted) throw new Error('构建已终止');
    const count = (await readdir(cacheDir)).length;
    await rm(cacheDir, { recursive: true, force: true });
    return count;
  }

  const relative = path.relative(workspace.path, repository.path).split(path.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('业务仓库不在主工程目录内');
  }
  let cleared = 0;
  for (const entry of await readdir(cacheDir, { withFileTypes: true })) {
    if (signal.aborted) throw new Error('构建已终止');
    const match = entry.isFile() && /^([a-f0-9]{16})-manifest\.json$/.exec(entry.name);
    if (!match) continue;
    let manifest: unknown;
    try { manifest = JSON.parse(await readFile(path.join(cacheDir, entry.name), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!manifest || typeof manifest !== 'object' || !('files' in manifest) || !manifest.files ||
      typeof manifest.files !== 'object' || Array.isArray(manifest.files)) continue;
    if (!Object.keys(manifest.files).some((file) => file === relative || file.startsWith(`${relative}/`))) continue;
    for (const suffix of artifactSuffixes) await rm(path.join(cacheDir, `${match[1]}${suffix}`), { force: true });
    cleared++;
  }
  return cleared;
}
