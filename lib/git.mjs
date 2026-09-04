import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runGit(cwd, args, options = {}) {
  try {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...(options.env || {}),
    };
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
      ...options,
      env,
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout ? err.stdout.trim() : '',
      stderr: err.stderr ? err.stderr.trim() : err.message,
    };
  }
}

export async function isGitRepo(dir) {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function getRepoStatus(repoPath, name, packageName = '') {
  const isGit = await isGitRepo(repoPath);
  if (!isGit) {
    return {
      name,
      packageName: packageName || name,
      path: repoPath,
      isGit: false,
    };
  }

  // 并行执行 5 项独立的 Git 状态检查，大幅削减 WSL 跨盘 I/O 等待时间
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
    const [hash, author, message, date] = commitRes.stdout.split('|');
    commit = { hash, author, message, date };
  }

  const dirtyLines = statusRes.success && statusRes.stdout ? statusRes.stdout.split('\n').filter(Boolean) : [];
  const isDirty = dirtyLines.length > 0;
  const dirtyCount = dirtyLines.length;
  const dirtyFiles = dirtyLines.slice(0, 15);

  const localBranches = localRes.success && localRes.stdout ? localRes.stdout.split('\n').filter(Boolean) : [];
  const remoteBranches = remoteRes.success && remoteRes.stdout
    ? remoteRes.stdout.split('\n').filter(Boolean).map(b => b.replace(/^origin\//, ''))
    : [];

  const uniqueBranches = Array.from(new Set([...localBranches, ...remoteBranches])).sort();

  return {
    name,
    packageName: packageName || name,
    path: repoPath,
    isGit: true,
    currentBranch,
    commit,
    isDirty,
    dirtyCount,
    dirtyFiles,
    localBranches,
    remoteBranches,
    allBranches: uniqueBranches,
  };
}

export async function scanAllRepos(targetRepoPath) {
  const rootPkgPath = path.join(targetRepoPath, 'package.json');
  let rootPkgName = 'shared';
  try {
    const rootPkgRaw = await fs.readFile(rootPkgPath, 'utf-8');
    const rootPkg = JSON.parse(rootPkgRaw);
    rootPkgName = rootPkg.name || 'shared';
  } catch {}

  const tasks = [];
  tasks.push(getRepoStatus(targetRepoPath, 'root (shared)', rootPkgName).then(s => ({ ...s, isRoot: true })));

  const appsDir = path.join(targetRepoPath, 'apps');
  try {
    const entries = await fs.readdir(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const appDir = path.join(appsDir, entry.name);
        tasks.push((async () => {
          let packageName = `@repo/${entry.name.replace(/^web-/, '')}`;
          try {
            const appPkgRaw = await fs.readFile(path.join(appDir, 'package.json'), 'utf-8');
            const appPkg = JSON.parse(appPkgRaw);
            if (appPkg.name) packageName = appPkg.name;
          } catch {}

          const appStatus = await getRepoStatus(appDir, entry.name, packageName);
          return { ...appStatus, isRoot: false };
        })());
      }
    }
  } catch (err) {
    console.warn('[Git] Failed to read apps directory:', err.message);
  }

  const repos = await Promise.all(tasks);
  return repos;
}

export async function fetchRepo(repoPath) {
  return runGit(repoPath, ['fetch', '-p']);
}

export async function stashRepo(repoPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return runGit(repoPath, ['stash', 'push', '-u', '-m', `dashboard-stash-${timestamp}`]);
}

export async function resetRepo(repoPath) {
  await runGit(repoPath, ['reset', '--hard', 'HEAD']);
  return runGit(repoPath, ['clean', '-fd']);
}

export async function checkoutRepo(repoPath, branchName, { force = false } = {}) {
  // Check dirty
  const statusRes = await runGit(repoPath, ['status', '--porcelain', '--ignore-submodules=dirty', '-uno']);
  if (statusRes.stdout && !force) {
    return {
      success: false,
      dirty: true,
      message: '工作区存在未提交的修改，请先暂存或放弃改动',
    };
  }

  // Check if branch exists locally
  const checkLocal = await runGit(repoPath, ['show-ref', '--verify', `refs/heads/${branchName}`]);
  if (checkLocal.success) {
    const res = await runGit(repoPath, ['checkout', branchName]);
    if (!res.success) return res;
    return { success: true, message: `已成功切换到本地分支 ${branchName}` };
  }

  // Check if exists on remote
  const checkRemote = await runGit(repoPath, ['show-ref', '--verify', `refs/remotes/origin/${branchName}`]);
  if (checkRemote.success) {
    const res = await runGit(repoPath, ['checkout', '-b', branchName, '--track', `origin/${branchName}`]);
    if (!res.success) return res;
    return { success: true, message: `已成功检出远程分支 origin/${branchName} 至本地` };
  }

  // Fallback direct checkout
  const directRes = await runGit(repoPath, ['checkout', branchName]);
  return directRes;
}

export async function batchCheckoutAll(targetRepoPath, branchName) {
  const allRepos = await scanAllRepos(targetRepoPath);
  const results = [];

  for (const repo of allRepos) {
    if (!repo.isGit) continue;
    await fetchRepo(repo.path);
    const hasBranch = repo.allBranches.includes(branchName);
    if (!hasBranch) {
      results.push({
        name: repo.name,
        path: repo.path,
        success: false,
        skipped: true,
        message: `不存在分支 ${branchName}，已跳过`,
      });
      continue;
    }

    const coRes = await checkoutRepo(repo.path, branchName);
    results.push({
      name: repo.name,
      path: repo.path,
      success: coRes.success,
      skipped: false,
      message: coRes.message || coRes.stderr || '切换成功',
    });
  }

  return results;
}

export async function getLocalBranchesDetail(repoPath, protectedBranches = []) {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map(b => b.trim())
  );
  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';

  // 1. 获取已合并到当前 HEAD 的本地分支
  const mergedRes = await runGit(repoPath, ['branch', '--merged']);
  const mergedSet = new Set(
    mergedRes.success
      ? mergedRes.stdout.split('\n').map(b => b.replace(/^[*+]\s*/, '').trim()).filter(Boolean)
      : []
  );

  // 2. 获取上游远程已删除 (gone) 的本地分支
  const vvRes = await runGit(repoPath, ['branch', '-vv']);
  const goneSet = new Set();
  if (vvRes.success && vvRes.stdout) {
    const lines = vvRes.stdout.split('\n');
    for (const line of lines) {
      if (line.includes(': gone]')) {
        const match = line.match(/^[*+]?\s*([^\s]+)/);
        if (match && match[1]) goneSet.add(match[1]);
      }
    }
  }

  // 3. 严格仅遍历本地分支 refs/heads/
  const listRes = await runGit(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)|%(authordate:relative)|%(subject)',
    'refs/heads/',
  ]);

  const branches = [];
  if (listRes.success && listRes.stdout) {
    const lines = listRes.stdout.split('\n').filter(Boolean);
    for (const line of lines) {
      const [name, relativeDate, subject] = line.split('|');
      const isCurrent = name === currentBranch;
      const isProtected = normalizedProtected.has(name);
      const isMerged = mergedSet.has(name) && !isCurrent;
      const isGone = goneSet.has(name) && !isCurrent;

      branches.push({
        name,
        relativeDate: relativeDate || '',
        subject: subject || '',
        isCurrent,
        isProtected,
        isMerged,
        isGone,
        canDelete: !isCurrent && !isProtected,
      });
    }
  }

  return {
    currentBranch,
    branches,
  };
}

export async function pruneBranches(repoPath, protectedBranches = []) {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map(b => b.trim())
  );

  await runGit(repoPath, ['fetch', '-p']);

  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';

  const mergedRes = await runGit(repoPath, ['branch', '--merged']);
  const mergedBranches = mergedRes.success
    ? mergedRes.stdout
        .split('\n')
        .map(b => b.replace(/^[*+]\s*/, '').trim())
        .filter(b => b && !normalizedProtected.has(b) && b !== currentBranch)
    : [];

  const vvRes = await runGit(repoPath, ['branch', '-vv']);
  const goneBranches = [];
  if (vvRes.success && vvRes.stdout) {
    const lines = vvRes.stdout.split('\n');
    for (const line of lines) {
      if (line.includes(': gone]')) {
        const branchMatch = line.match(/^[*+]?\s*([^\s]+)/);
        if (branchMatch && branchMatch[1]) {
          const b = branchMatch[1];
          if (!normalizedProtected.has(b) && b !== currentBranch) {
            goneBranches.push(b);
          }
        }
      }
    }
  }

  const toDelete = Array.from(new Set([...mergedBranches, ...goneBranches]));
  const deleted = [];
  const errors = [];

  for (const b of toDelete) {
    const delRes = await runGit(repoPath, ['branch', '-D', b]);
    if (delRes.success) {
      deleted.push(b);
    } else {
      errors.push({ branch: b, error: delRes.stderr });
    }
  }

  return {
    deleted,
    errors,
    message: `成功清理 ${deleted.length} 个失效/已合并分支`,
  };
}

export async function deleteSpecificBranches(repoPath, branchesToDelete = [], protectedBranches = []) {
  const normalizedProtected = new Set(
    ['master', 'main', 'develop', 'test', ...protectedBranches].map(b => b.trim())
  );
  const curRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = curRes.success ? curRes.stdout : '';

  const deleted = [];
  const errors = [];

  for (const b of branchesToDelete) {
    if (normalizedProtected.has(b)) {
      errors.push({ branch: b, error: '受保护分支禁止删除' });
      continue;
    }
    if (b === currentBranch) {
      errors.push({ branch: b, error: '当前检出分支禁止删除' });
      continue;
    }

    const delRes = await runGit(repoPath, ['branch', '-D', b]);
    if (delRes.success) {
      deleted.push(b);
    } else {
      errors.push({ branch: b, error: delRes.stderr });
    }
  }

  return { deleted, errors };
}
