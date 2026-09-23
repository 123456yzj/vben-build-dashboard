import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { applyUpdate } from '../dist/updates.js';

const run = promisify(execFile);

test('installs a checked release and restores old files if replacement fails', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dashboard-update-test-'));
  const staging = path.join(directory, 'staging');
  const archive = path.join(directory, 'runtime.tar.gz');
  let server;
  try {
    for (const name of ['agent', 'frontend']) {
      await mkdir(path.join(directory, name, 'dist'), { recursive: true });
      await writeFile(path.join(directory, name, 'dist', 'old.txt'), name);
      await mkdir(path.join(staging, name, 'dist'), { recursive: true });
      await writeFile(path.join(staging, name, 'dist', 'new.txt'), name);
    }
    await writeFile(path.join(directory, 'package-lock.json'), 'unchanged dependencies');
    await run('tar', ['-czf', archive, '-C', staging, 'agent/dist', 'frontend/dist']);
    const payload = await readFile(archive);
    server = createServer((_request, response) => response.end(payload));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/runtime.tar.gz`;
    const manifest = {
      version: 'a'.repeat(40),
      lockHash: createHash('sha256').update('unchanged dependencies').digest('hex'),
      sha256: createHash('sha256').update(payload).digest('hex'),
    };

    await assert.rejects(applyUpdate({ ...manifest, sha256: '0'.repeat(64) }, url, directory), /校验失败/);
    assert.equal(await readFile(path.join(directory, 'agent', 'dist', 'old.txt'), 'utf8'), 'agent');
    await assert.rejects(applyUpdate({ ...manifest, lockHash: '0'.repeat(64) }, url, directory), /依赖版本已变化/);

    await mkdir(path.join(directory, 'update.json'));
    await assert.rejects(applyUpdate(manifest, url, directory), /EISDIR/);
    for (const name of ['agent', 'frontend']) {
      assert.equal(await readFile(path.join(directory, name, 'dist', 'old.txt'), 'utf8'), name);
    }
    await rm(path.join(directory, 'update.json'), { recursive: true });
    await applyUpdate(manifest, url, directory);
    for (const name of ['agent', 'frontend']) {
      assert.equal(await readFile(path.join(directory, name, 'dist', 'new.txt'), 'utf8'), name);
    }
    assert.equal(JSON.parse(await readFile(path.join(directory, 'update.json'), 'utf8')).version, manifest.version);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
