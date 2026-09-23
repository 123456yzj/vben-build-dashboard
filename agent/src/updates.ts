import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseUrl = 'https://api.github.com/repos/123456yzj/vben-build-dashboard/releases/tags/runtime-latest';
type Manifest = { version: string; lockHash: string; sha256: string };
let updating = false;

async function currentVersion(): Promise<string | null> {
  try { return (JSON.parse(await readFile(path.join(root, 'update.json'), 'utf8')) as { version: string }).version; }
  catch { return null; }
}

async function fetchRelease(): Promise<{ manifest: Manifest; archiveUrl: string }> {
  const response = await fetch(releaseUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vben-build-dashboard' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`无法获取发布版本 (HTTP ${response.status})`);
  const release = await response.json() as { assets: { name: string; browser_download_url: string }[] };
  const manifestUrl = release.assets.find((asset) => asset.name === 'runtime.json')?.browser_download_url;
  const archiveUrl = release.assets.find((asset) => asset.name === 'runtime.tar.gz')?.browser_download_url;
  if (!manifestUrl || !archiveUrl) throw new Error('发布版本缺少更新文件');
  const manifestResponse = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) });
  if (!manifestResponse.ok) throw new Error('无法读取更新清单');
  const manifest = await manifestResponse.json() as Manifest;
  if (typeof manifest.version !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.version) ||
    ![manifest.lockHash, manifest.sha256].every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('更新清单格式错误');
  }
  return { manifest, archiveUrl };
}

async function download(url: string, destination: string, expectedHash: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`下载更新文件失败 (HTTP ${response.status})`);
  const output = await open(destination, 'w');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 50 * 1024 * 1024) throw new Error('更新文件过大');
      hash.update(chunk);
      await output.writeFile(chunk);
    }
  } finally { await output.close(); }
  if (hash.digest('hex') !== expectedHash) throw new Error('更新文件校验失败');
}

export async function applyUpdate(manifest: Manifest, archiveUrl: string, directory = root): Promise<void> {
  const lockHash = createHash('sha256').update(await readFile(path.join(directory, 'package-lock.json'))).digest('hex');
  if (lockHash !== manifest.lockHash) throw new Error('依赖版本已变化，请使用 Docker 镜像更新');
  const temp = await mkdtemp(path.join(directory, '.update-'));
  try {
    const archive = path.join(temp, 'runtime.tar.gz');
    await download(archiveUrl, archive, manifest.sha256);
    const { stdout } = await run('tar', ['-tzf', archive], { maxBuffer: 1024 * 1024 });
    if (stdout.split('\n').filter(Boolean).some((entry) => entry.startsWith('/') || entry.split('/').includes('..') || !/^(agent|frontend)\/dist(?:\/|$)/.test(entry))) {
      throw new Error('更新文件包含意外路径');
    }
    await run('tar', ['-xzf', archive, '-C', temp]);
    for (const name of ['agent', 'frontend']) {
      if (!(await stat(path.join(temp, name, 'dist'))).isDirectory()) throw new Error('更新文件不完整');
    }
    const replaced: string[] = [];
    try {
      for (const name of ['frontend', 'agent']) {
        const target = path.join(directory, name, 'dist');
        await rename(target, path.join(temp, `${name}-old`));
        try { await rename(path.join(temp, name, 'dist'), target); }
        catch (error) { await rename(path.join(temp, `${name}-old`), target); throw error; }
        replaced.push(name);
      }
      await writeFile(path.join(directory, 'update.json'), JSON.stringify({ version: manifest.version }) + '\n');
    } catch (error) {
      for (const name of replaced.reverse()) {
        await rm(path.join(directory, name, 'dist'), { recursive: true, force: true });
        await rename(path.join(temp, `${name}-old`), path.join(directory, name, 'dist'));
      }
      throw error;
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
}

export function registerUpdateRoutes(app: FastifyInstance): void {
  app.get('/api/system/update', async () => {
    const current = await currentVersion();
    const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string };
    if (!current || current === 'dev') return { available: false, current: null, latest: null, supported: false, version };
    try {
      const { manifest } = await fetchRelease();
      return { available: current !== manifest.version, current, latest: manifest.version, supported: true, version };
    } catch (error) {
      return { available: false, current, latest: null, supported: true, version, error: (error as Error).message };
    }
  });
  app.post('/api/system/update', async (_request, reply) => {
    const current = await currentVersion();
    if (!current || current === 'dev') return reply.code(400).send({ error: '仅支持已发布的 Docker 镜像在线更新' });
    if (updating) return reply.code(409).send({ error: '更新正在进行中' });
    updating = true;
    try {
      const { manifest, archiveUrl } = await fetchRelease();
      if (current === manifest.version) return { updated: false };
      await applyUpdate(manifest, archiveUrl);
      setTimeout(() => process.exit(0), 1000).unref();
      return { updated: true };
    } finally { updating = false; }
  });
}
