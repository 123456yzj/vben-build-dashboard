import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { GitResult, RepoStatus } from '../types.js';

type RunGitOptions = Omit<ExecFileOptionsWithStringEncoding, 'encoding'>;

interface PackageJson {
  name?: unknown;
}

interface CheckoutOptions {
  force?: boolean;
}

type CheckoutResult = GitResult | {
  success: true;
  message: string;
} | {
  success: false;
  dirty: true;
  message: string;
};

interface ScannedRepo extends RepoStatus {
  isRoot: boolean;
}

interface BatchCheckoutResult {
  name: string;
  path: string;
  success: boolean;
  skipped: boolean;
  message: string;
}

interface BranchDetail {
  name: string;
  relativeDate: string;
  subject: string;
  isCurrent: boolean;
  isProtected: boolean;
  isMerged: boolean;
  isGone: boolean;
  canDelete: boolean;
}

interface BranchError {
  branch: string;
  error: string;
}

function errorField(error: unknown, field: 'stdout' | 'stderr'): string {
  if (typeof error !== 'object' || error === null || !(field in error)) return '';
  const value = (error as Record<string, unknown>)[field];
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value)) return value.toString().trim();
  return '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function packageNameFromJson(raw: string): string | undefined {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const name = (parsed as PackageJson).name;
  return typeof name === 'string' && name ? name : undefined;
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<GitResult> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    ...(options.env ?? {}),
  };

  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
        ...options,
        env,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            stdout: errorField(error, 'stdout'),
            stderr: errorField(error, 'stderr') || errorMessage(error),
          });
          return;
        }
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function getRepoStatus(
  repoPath: string,
  name: string,
  packageName = '',
): Promise<RepoStatus> {
  const isGit = await isGitRepo(repoPath);
  if (!isGit) {
    return {
      name,
      packageName: packageName || name,
      path: repoPath,
      isGit: false,
    };
  }

  // These checks are independent, and running them concurrently matters for WSL cross-drive I/O.
  const [branchRes, commitRes, statusRes, localRes, remoteRes] = await Promise.all([
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(repoPath, ['log', '-1', '--format=%h|%an|%s|%ci']),
    runGit(repoPath, ['status', '--porcelain', '--ignore-submodules=dirty', '-uno']),
    runGit(repoPath, ['branch', '--format=%(refname:short)']),
    runGit(repoPath, ['branch', '-r', '--format=%(refname:short)']),
  ]);

  const currentBranch = branchRes.success ? branchRes.stdout : 'unknown';
  let commit = { hash: '', author: '', message: '', date: '' };
  if (commitRes.success && commitRes.stdout) {
    const [hash = '', author = '', message = '', date = ''] = commitRes.stdout.split('|');
    commit = { hash, author, message, date };
  }

  const dirtyLines = statusRes.success && statusRes.stdout
    ? statusRes.stdout.split('\n').filter(Boolean)
    : [];
  const localBranches = localRes.success && localRes.stdout
    ? localRes.stdout.split('\n').filter(Boolean)
    : [];
  const remoteBranches = remoteRes.success && remoteRes.stdout
    ? remoteRes.stdout.split('\n').filter(Boolean).map((branch) => branch.replace(/^origin\//, ''))
    : [];

  return {
    name,
    packageName: packageName || name,
    path: repoPath,
    isGit: true,
    currentBranch,
    commit,
    isDirty: dirtyLines.length > 0,
    dirtyCount: dirtyLines.length,
    dirtyFiles: dirtyLines.slice(0, 15),
    localBranches,
    remoteBranches,
    allBranches: Array.from(new Set([...localBranches, ...remoteBranches])).sort(),
  };
}

export async function scanAllRepos(targetRepoPath: string): Promise<ScannedRepo[]> {
  let rootPkgName = 'shared';
  try {
    const raw = await fs.readFile(path.join(targetRepoPath, 'package.json'), 'utf8');
    rootPkgName = packageNameFromJson(raw) ?? 'shared';
  } catch {}

  const tasks: Array<Promise<ScannedRepo>> = [
    getRepoStatus(targetRepoPath, 'root (shared)', rootPkgName).then((status) => ({
      ...status,
      isRoot: true,
    })),
  ];

  const appsDir = path.join(targetRepoPath, 'apps');
  try {
    const entries = await fs.readdir(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const appDir = path.join(appsDir, entry.name);
      tasks.push((async () => {
        let packageName = `@repo/${entry.name.replace(/^web-/, '')}`;
        try {
          const raw = await fs.readFile(path.join(appDir, 'package.json'), 'utf8');
          packageName = packageNameFromJson(raw) ?? packageName;
        } catch {}
        const status = await getRepoStatus(appDir, entry.name, packageName);
        return { ...status, isRoot: false };
      })());
    }
  } catch (error) {
    console.warn('[Git] Failed to read apps directory:', errorMessage(error));
  }

  return Promise.all(tasks);
}

export async function fetchRepo(repoPath: string): Promise<GitResult> {
  return runGit(repoPath, ['fetch', '-p']);
}

export async function stashRepo(repoPath: string): Promise<GitResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return runGit(repoPath, ['stash', 'push', '-u', '-m', `dashboard-stash-${timestamp}`]);
}

export async function resetRepo(repoPath: string): Promise<GitResult> {
  await runGit(repoPath, ['reset', '--hard', 'HEAD']);
  return runGit(repoPath, ['clean', '-fd']);
}

export async function checkoutRepo(
  repoPath: string,
  branchName: string,
  { force = false }: CheckoutOptions = {},
): Promise<CheckoutResult> {
  const statusRes = await runGit(repoPath, [
    'status', '--porcelain', '--ignore-submodules=dirty', '-uno',
  ]);
  if (statusRes.stdout && !force) {
    return {
      success: false,
      dirty: true,
      message: '工作区存在未提交的修改，请先暂存或放弃改动',
    };
  }

  const checkLocal = await runGit(repoPath, ['show-ref', '--verify', `refs/heads/${branchName}`]);
  if (checkLocal.success) {
    const result = await runGit(repoPath, ['checkout', branchName]);
    if (!result.success) return result;
    return { success: true, message: `已成功切换到本地分支 ${branchName}` };
  }

  const checkRemote = await runGit(repoPath, [
    'show-ref', '--verify', `refs/remotes/origin/${branchName}`,
  ]);
  if (checkRemote.success) {
    const result = await runGit(repoPath, [
      'checkout', '-b', branchName, '--track', `origin/${branchName}`,
    ]);
    if (!result.success) return result;
    return {
      success: true,
      message: `已成功检出远程分支 origin/${branchName} 至本地`,
    };
  }

  return runGit(repoPath, ['checkout', branchName]);
}

function checkoutMessage(result: CheckoutResult): string {
  if ('message' in result && result.message) return result.message;
  if ('stderr' in result && result.stderr) return result.stderr;
  return '切换成功';
}

export async function batchCheckoutAll(
  targetRepoPath: string,
  branchName: string,
): Promise<BatchCheckoutResult[]> {
  const allRepos = await scanAllRepos(targetRepoPath);
  const results: BatchCheckoutResult[] = [];

  for (const repo of allRepos) {
    if (!repo.isGit) continue;
    await fetchRepo(repo.path);
    if (!repo.allBranches?.includes(branchName)) {
      results.push({
        name: repo.name,
        path: repo.path,
        success: false,
        skipped: true,
        message: `不存在分支 ${branchName}，已跳过`,
      });
      continue;
    }

    const checkout = await checkoutRepo(repo.path, branchName);
    results.push({
      name: repo.name,
      path: repo.path,
      success: checkout.success,
      skipped: false,
      message: checkoutMessage(checkout),
    });
  }

  return results;
}

export async function getLocalBranchesDetail(
  repoPath: string,
  protectedBranches: string[] = [],
): Promise<{ currentBranch: string; branches: BranchDetail[] }> {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map((branch) => branch.trim()),
  );
  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';

  const mergedRes = await runGit(repoPath, ['branch', '--merged']);
  const mergedSet = new Set(
    mergedRes.success
      ? mergedRes.stdout.split('\n').map((branch) => branch.replace(/^[*+]\s*/, '').trim()).filter(Boolean)
      : [],
  );

  const vvRes = await runGit(repoPath, ['branch', '-vv']);
  const goneSet = new Set<string>();
  if (vvRes.success && vvRes.stdout) {
    for (const line of vvRes.stdout.split('\n')) {
      if (!line.includes(': gone]')) continue;
      const match = line.match(/^[*+]?\s*([^\s]+)/);
      if (match?.[1]) goneSet.add(match[1]);
    }
  }

  const listRes = await runGit(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)|%(authordate:relative)|%(subject)',
    'refs/heads/',
  ]);

  const branches: BranchDetail[] = [];
  if (listRes.success && listRes.stdout) {
    for (const line of listRes.stdout.split('\n').filter(Boolean)) {
      const [name = '', relativeDate = '', subject = ''] = line.split('|');
      const isCurrent = name === currentBranch;
      const isProtected = normalizedProtected.has(name);
      branches.push({
        name,
        relativeDate,
        subject,
        isCurrent,
        isProtected,
        isMerged: mergedSet.has(name) && !isCurrent,
        isGone: goneSet.has(name) && !isCurrent,
        canDelete: !isCurrent && !isProtected,
      });
    }
  }

  return { currentBranch, branches };
}

export async function pruneBranches(
  repoPath: string,
  protectedBranches: string[] = [],
): Promise<{ deleted: string[]; errors: BranchError[]; message: string }> {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map((branch) => branch.trim()),
  );
  await runGit(repoPath, ['fetch', '-p']);

  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';
  const mergedRes = await runGit(repoPath, ['branch', '--merged']);
  const mergedBranches = mergedRes.success
    ? mergedRes.stdout
        .split('\n')
        .map((branch) => branch.replace(/^[*+]\s*/, '').trim())
        .filter((branch) => branch && !normalizedProtected.has(branch) && branch !== currentBranch)
    : [];

  const vvRes = await runGit(repoPath, ['branch', '-vv']);
  const goneBranches: string[] = [];
  if (vvRes.success && vvRes.stdout) {
    for (const line of vvRes.stdout.split('\n')) {
      if (!line.includes(': gone]')) continue;
      const branch = line.match(/^[*+]?\s*([^\s]+)/)?.[1];
      if (branch && !normalizedProtected.has(branch) && branch !== currentBranch) {
        goneBranches.push(branch);
      }
    }
  }

  const deleted: string[] = [];
  const errors: BranchError[] = [];
  for (const branch of new Set([...mergedBranches, ...goneBranches])) {
    const result = await runGit(repoPath, ['branch', '-D', branch]);
    if (result.success) deleted.push(branch);
    else errors.push({ branch, error: result.stderr });
  }

  return {
    deleted,
    errors,
    message: `成功清理 ${deleted.length} 个失效/已合并分支`,
  };
}

export async function deleteSpecificBranches(
  repoPath: string,
  branchesToDelete: string[] = [],
  protectedBranches: string[] = [],
): Promise<{ deleted: string[]; errors: BranchError[] }> {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map((branch) => branch.trim()),
  );
  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';
  const deleted: string[] = [];
  const errors: BranchError[] = [];

  for (const branch of branchesToDelete) {
    if (normalizedProtected.has(branch)) {
      errors.push({ branch, error: '受保护分支禁止删除' });
      continue;
    }
    if (branch === currentBranch) {
      errors.push({ branch, error: '当前检出分支禁止删除' });
      continue;
    }

    const result = await runGit(repoPath, ['branch', '-D', branch]);
    if (result.success) deleted.push(branch);
    else errors.push({ branch, error: result.stderr });
  }

  return { deleted, errors };
}
