import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project } from './projects.js';
import { execute, type Output } from './process.js';
import { getGitStatus } from './git.js';

export type BuildState = 'pending' | 'running' | 'success' | 'failed';
export interface BuildRecord {
  id: string;
  project: string;
  branch: string;
  time: string;
  status: BuildState;
  duration: number | null;
}

export class BuildStore {
  private records: BuildRecord[] = [];
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('build history must be an array');
      this.records = parsed as BuildRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const record of this.records) {
      if (record.status === 'pending' || record.status === 'running') record.status = 'failed';
    }
    await this.persist();
  }

  list(project: string): BuildRecord[] { return this.records.filter((record) => record.project === project); }

  async create(project: Project): Promise<BuildRecord> {
    const record: BuildRecord = { id: randomUUID(), project: project.name, branch: (await getGitStatus(project)).branch, time: new Date().toISOString(), status: 'pending', duration: null };
    this.records.unshift(record);
    this.records = this.records.slice(0, 100);
    await this.persist();
    return record;
  }

  async update(record: BuildRecord, status: BuildState): Promise<void> {
    record.status = status;
    if (status === 'success' || status === 'failed') record.duration = Date.now() - Date.parse(record.time);
    await this.persist();
  }

  private persist(): Promise<void> {
    const save = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(this.records, null, 2) + '\n');
      await rename(temp, this.file);
    };
    this.queue = this.queue.then(save);
    return this.queue;
  }
}

export async function runBuild(project: Project, record: BuildRecord, store: BuildStore, output: Output, onStatus: () => void): Promise<void> {
  try {
    await store.update(record, 'running');
    onStatus();
    await execute(project.buildCommand, [], project.path, output, true);
    await store.update(record, 'success');
  } catch (error) {
    output('stderr', `\nBuild failed: ${(error as Error).message.slice(-300)}\n`);
    await store.update(record, 'failed');
  }
  onStatus();
}
