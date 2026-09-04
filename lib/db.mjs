import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'dashboard.db');
    dbInstance = new DatabaseSync(dbPath);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    initTables();
  }
  return dbInstance;
}

function initTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos_cache (
      name TEXT PRIMARY KEY,
      package_name TEXT,
      path TEXT,
      is_git INTEGER,
      is_root INTEGER,
      current_branch TEXT,
      commit_info TEXT,
      is_dirty INTEGER,
      dirty_count INTEGER,
      dirty_files TEXT,
      local_branches TEXT,
      remote_branches TEXT,
      all_branches TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS build_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packages TEXT,
      mode TEXT,
      status TEXT,
      start_time INTEGER,
      duration_sec INTEGER,
      node_version TEXT,
      max_memory_mb INTEGER,
      created_at INTEGER
    );
  `);
}

/**
 * 从 SQLite 获取缓存的子仓与分支全量列表
 */
export function getCachedRepos() {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repos_cache ORDER BY is_root DESC, name ASC;');
  const rows = stmt.all();

  return rows.map((row) => ({
    name: row.name,
    packageName: row.package_name,
    path: row.path,
    isGit: Boolean(row.is_git),
    isRoot: Boolean(row.is_root),
    currentBranch: row.current_branch || 'unknown',
    commit: row.commit_info ? safeJsonParse(row.commit_info, {}) : { hash: '', author: '', message: '', date: '' },
    isDirty: Boolean(row.is_dirty),
    dirtyCount: Number(row.dirty_count || 0),
    dirtyFiles: row.dirty_files ? safeJsonParse(row.dirty_files, []) : [],
    localBranches: row.local_branches ? safeJsonParse(row.local_branches, []) : [],
    remoteBranches: row.remote_branches ? safeJsonParse(row.remote_branches, []) : [],
    allBranches: row.all_branches ? safeJsonParse(row.all_branches, []) : [],
    updatedAt: Number(row.updated_at || 0),
  }));
}

/**
 * 清空仓库缓存表
 */
export function clearCachedRepos() {
  const db = getDb();
  db.exec('DELETE FROM repos_cache;');
}

/**
 * 原子性重置并落库最新仓库快照（事务：清空 -> 批量插入）
 */
export function refreshReposCache(repos = []) {
  const db = getDb();
  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec('DELETE FROM repos_cache;');
    if (Array.isArray(repos) && repos.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO repos_cache (
          name, package_name, path, is_git, is_root, current_branch,
          commit_info, is_dirty, dirty_count, dirty_files,
          local_branches, remote_branches, all_branches, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      const now = Date.now();
      for (const r of repos) {
        stmt.run(
          r.name,
          r.packageName || r.name,
          r.path,
          r.isGit ? 1 : 0,
          r.isRoot ? 1 : 0,
          r.currentBranch || '',
          JSON.stringify(r.commit || {}),
          r.isDirty ? 1 : 0,
          r.dirtyCount || 0,
          JSON.stringify(r.dirtyFiles || []),
          JSON.stringify(r.localBranches || []),
          JSON.stringify(r.remoteBranches || []),
          JSON.stringify(r.allBranches || []),
          now
        );
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * 批量将 Git 扫描结果持久化写入 SQLite（增量/更新）
 */
export function saveCachedRepos(repos = []) {
  if (!Array.isArray(repos) || repos.length === 0) return;
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO repos_cache (
      name, package_name, path, is_git, is_root, current_branch,
      commit_info, is_dirty, dirty_count, dirty_files,
      local_branches, remote_branches, all_branches, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const now = Date.now();
  for (const r of repos) {
    stmt.run(
      r.name,
      r.packageName || r.name,
      r.path,
      r.isGit ? 1 : 0,
      r.isRoot ? 1 : 0,
      r.currentBranch || '',
      JSON.stringify(r.commit || {}),
      r.isDirty ? 1 : 0,
      r.dirtyCount || 0,
      JSON.stringify(r.dirtyFiles || []),
      JSON.stringify(r.localBranches || []),
      JSON.stringify(r.remoteBranches || []),
      JSON.stringify(r.allBranches || []),
      now
    );
  }
}

/**
 * 检出分支后快速原地更新数据库，无需等待耗时的全量物理扫描
 */
export function updateRepoBranch(repoPathOrName, newBranch) {
  if (!repoPathOrName || !newBranch) return;
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE repos_cache
    SET current_branch = ?, updated_at = ?
    WHERE path = ? OR name = ?;
  `);
  stmt.run(newBranch, Date.now(), repoPathOrName, repoPathOrName);
}

/**
 * 记录构建历史
 */
export function saveBuildRecord({
  packages = [],
  mode = 'development',
  status = 'success',
  startTime = Date.now(),
  durationSec = 0,
  nodeVersion = '',
  maxMemoryMb = 8192,
}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO build_history (
      packages, mode, status, start_time, duration_sec, node_version, max_memory_mb, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `);
  stmt.run(
    JSON.stringify(packages),
    mode,
    status,
    startTime,
    durationSec,
    nodeVersion,
    maxMemoryMb,
    Date.now()
  );
}

/**
 * 获取最近构建历史列表
 */
export function getBuildHistory(limit = 20) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM build_history ORDER BY id DESC LIMIT ?;');
  const rows = stmt.all(limit);

  return rows.map((r) => ({
    id: r.id,
    packages: safeJsonParse(r.packages, []),
    mode: r.mode,
    status: r.status,
    startTime: r.start_time,
    durationSec: r.duration_sec,
    nodeVersion: r.node_version,
    maxMemoryMb: r.max_memory_mb,
    createdAt: r.created_at,
  }));
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
