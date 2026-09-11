import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import type { CommitInfo, RepoStatus } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '../..');
const repoRootDir = path.resolve(backendDir, '..');

interface RepoRow {
  name: string;
  package_name: string | null;
  path: string;
  is_git: number;
  is_root: number;
  current_branch: string | null;
  commit_info: string | null;
  is_dirty: number;
  dirty_count: number;
  dirty_files: string | null;
  local_branches: string | null;
  remote_branches: string | null;
  all_branches: string | null;
  updated_at: number;
}

export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const rootData = path.join(repoRootDir, 'data');
  if (existsSync(rootData)) return rootData;
  const backendData = path.join(backendDir, 'data');
  if (existsSync(backendData)) return backendData;
  return existsSync(path.join(repoRootDir, 'package.json')) ? rootData : backendData;
}

const dataDir = resolveDataDir();
let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    dbInstance = new DatabaseSync(path.join(dataDir, 'dashboard.db'));
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    initTables();
  }
  return dbInstance;
}

function initTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS repos_cache (
      name TEXT PRIMARY KEY, package_name TEXT, path TEXT, is_git INTEGER,
      is_root INTEGER, current_branch TEXT, commit_info TEXT, is_dirty INTEGER,
      dirty_count INTEGER, dirty_files TEXT, local_branches TEXT,
      remote_branches TEXT, all_branches TEXT, updated_at INTEGER
    );
  `);
}

export function getCachedRepos(): RepoStatus[] {
  const rows = getDb().prepare('SELECT * FROM repos_cache ORDER BY is_root DESC, name ASC;').all() as unknown as RepoRow[];
  return rows.map((row) => ({
    name: row.name,
    packageName: row.package_name ?? row.name,
    path: row.path,
    isGit: Boolean(row.is_git),
    isRoot: Boolean(row.is_root),
    currentBranch: row.current_branch || 'unknown',
    commit: row.commit_info ? safeJsonParse<CommitInfo>(row.commit_info, emptyCommit()) : emptyCommit(),
    isDirty: Boolean(row.is_dirty),
    dirtyCount: Number(row.dirty_count || 0),
    dirtyFiles: row.dirty_files ? safeJsonParse<string[]>(row.dirty_files, []) : [],
    localBranches: row.local_branches ? safeJsonParse<string[]>(row.local_branches, []) : [],
    remoteBranches: row.remote_branches ? safeJsonParse<string[]>(row.remote_branches, []) : [],
    allBranches: row.all_branches ? safeJsonParse<string[]>(row.all_branches, []) : [],
    updatedAt: Number(row.updated_at || 0),
  }));
}

export function clearCachedRepos(): void {
  getDb().exec('DELETE FROM repos_cache;');
}

function insertRepo(statement: ReturnType<DatabaseSync['prepare']>, repo: RepoStatus, now: number): void {
  statement.run(
    repo.name, repo.packageName || repo.name, repo.path, repo.isGit ? 1 : 0,
    repo.isRoot ? 1 : 0, repo.currentBranch || '', JSON.stringify(repo.commit || {}),
    repo.isDirty ? 1 : 0, repo.dirtyCount || 0, JSON.stringify(repo.dirtyFiles || []),
    JSON.stringify(repo.localBranches || []), JSON.stringify(repo.remoteBranches || []),
    JSON.stringify(repo.allBranches || []), now,
  );
}

const INSERT_SQL = `
  INSERT INTO repos_cache (
    name, package_name, path, is_git, is_root, current_branch, commit_info,
    is_dirty, dirty_count, dirty_files, local_branches, remote_branches,
    all_branches, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

export function refreshReposCache(repos: RepoStatus[] = []): void {
  const db = getDb();
  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec('DELETE FROM repos_cache;');
    if (repos.length > 0) {
      const statement = db.prepare(INSERT_SQL);
      const now = Date.now();
      for (const repo of repos) insertRepo(statement, repo, now);
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function saveCachedRepos(repos: RepoStatus[] = []): void {
  if (repos.length === 0) return;
  const statement = getDb().prepare(INSERT_SQL.replace('INSERT INTO', 'INSERT OR REPLACE INTO'));
  const now = Date.now();
  for (const repo of repos) insertRepo(statement, repo, now);
}

export function updateRepoBranch(repoPathOrName: string, newBranch: string): void {
  if (!repoPathOrName || !newBranch) return;
  getDb().prepare(`
    UPDATE repos_cache SET current_branch = ?, updated_at = ?
    WHERE path = ? OR name = ?;
  `).run(newBranch, Date.now(), repoPathOrName, repoPathOrName);
}

function emptyCommit(): CommitInfo {
  return { hash: '', author: '', message: '', date: '' };
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
