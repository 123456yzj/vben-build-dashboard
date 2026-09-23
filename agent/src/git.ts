import type { Project } from './projects.js';
import { execute, type Output } from './process.js';

export interface GitStatus {
  branch: string;
  hash: string;
  message: string;
  clean: boolean;
  localBranches: string[];
  remoteBranches: string[];
}

const git = (project: Project, args: string[], output?: Output) => execute('git', args, project.path, output);
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

export async function getGitStatus(project: Project): Promise<GitStatus> {
  const [branch, hash, message, porcelain, local, remote] = await Promise.all([
    git(project, ['branch', '--show-current']),
    git(project, ['rev-parse', '--short', 'HEAD']),
    git(project, ['log', '-1', '--format=%s']),
    git(project, ['status', '--porcelain']),
    git(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
    git(project, ['for-each-ref', '--format=%(refname:short)%09%(symref)', 'refs/remotes/']),
  ]);
  return { branch: branch || '(detached)', hash, message, clean: !porcelain, localBranches: lines(local), remoteBranches: lines(remote).filter((ref) => !ref.includes('\t')).map((ref) => ref.split('\t')[0]!) };
}

export async function gitAction(project: Project, action: 'fetch' | 'pull' | 'checkout', branch: string | undefined, output: Output): Promise<void> {
  if (action === 'fetch') {
    await git(project, ['fetch', '--all'], output);
  } else if (action === 'pull') {
    if (!(await getGitStatus(project)).clean) throw new Error('工作区有未提交改动，请先手动处理');
    await git(project, ['pull', '--ff-only'], output);
  } else {
    const status = await getGitStatus(project);
    if (!status.clean) throw new Error('工作区有未提交改动，请先手动处理');
    if (!branch || (branch !== status.branch && !status.localBranches.includes(branch) && !status.remoteBranches.includes(branch))) {
      throw new Error('分支不在本地或远程分支列表中');
    }
    if (branch === status.branch) return;
    await git(project, status.localBranches.includes(branch) ? ['switch', '--', branch] : ['switch', '--track', branch], output);
  }
}
