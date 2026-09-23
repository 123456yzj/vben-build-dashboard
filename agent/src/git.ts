import type { Repository } from './workspaces.js';
import { execute, type Output } from './process.js';

export interface GitStatus {
  branch: string;
  hash: string;
  message: string;
  clean: boolean;
  localBranches: string[];
  remoteBranches: string[];
}

const git = (repository: Repository, args: string[], output?: Output) => execute('git', args, repository.path, output);
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

export async function getGitStatus(repository: Repository): Promise<GitStatus> {
  const [branch, hash, message, porcelain, local, remote] = await Promise.all([
    git(repository, ['branch', '--show-current']),
    git(repository, ['rev-parse', '--short', 'HEAD']),
    git(repository, ['log', '-1', '--format=%s']),
    git(repository, ['status', '--porcelain']),
    git(repository, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
    git(repository, ['for-each-ref', '--format=%(refname:short)%09%(symref)', 'refs/remotes/']),
  ]);
  return { branch: branch || '(detached)', hash, message, clean: !porcelain, localBranches: lines(local), remoteBranches: lines(remote).filter((ref) => !ref.includes('\t')).map((ref) => ref.split('\t')[0]!) };
}

export async function gitAction(repository: Repository, action: 'fetch' | 'pull' | 'checkout', branch: string | undefined, output: Output): Promise<void> {
  if (action === 'fetch') {
    await git(repository, ['fetch', '--all'], output);
  } else if (action === 'pull') {
    if (!(await getGitStatus(repository)).clean) throw new Error('仓库有未提交改动，请先手动处理');
    await git(repository, ['pull', '--ff-only'], output);
  } else {
    const status = await getGitStatus(repository);
    if (!status.clean) throw new Error('仓库有未提交改动，请先手动处理');
    if (!branch || (branch !== status.branch && !status.localBranches.includes(branch) && !status.remoteBranches.includes(branch))) {
      throw new Error('分支不在本地或远程分支列表中');
    }
    if (branch === status.branch) return;
    await git(repository, status.localBranches.includes(branch) ? ['switch', '--', branch] : ['switch', '--track', branch], output);
  }
}

export async function runGitAction(
  repository: Repository,
  action: 'fetch' | 'pull' | 'checkout',
  branch: string | undefined,
  output: Output,
  publish: (event: object) => void,
): Promise<GitStatus> {
  await gitAction(repository, action, branch, output);
  const status = await getGitStatus(repository);
  publish({ type: 'git', workspace: repository.workspace, repository: repository.name, git: status });
  return status;
}
