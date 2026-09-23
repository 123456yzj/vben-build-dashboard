import { request } from './request';
import type { GitAction, GitInfo } from '../types/git';
import type { BuildTask } from '../types/build';
import type { Workspace, WorkspaceDetail, Repository, TaskDetail } from '../types/workspace';

const base = (name: string) => `/api/workspaces/${encodeURIComponent(name)}`;

export const getWorkspaces = () => request<Workspace[]>('/api/workspaces');
export const getWorkspace = (name: string) => request<WorkspaceDetail>(base(name));
export const getRepositories = (name: string, refresh = false) =>
  request<Repository[]>(`${base(name)}/repositories${refresh ? '?refresh=true' : ''}`);
export const getBuilds = (name: string) => request<BuildTask[]>(`${base(name)}/builds`);
export const getBuild = (name: string, id: string) => request<TaskDetail>(`${base(name)}/builds/${encodeURIComponent(id)}`);
export const gitAction = (workspace: string, repository: string, action: GitAction, branch?: string) =>
  request<{ git: GitInfo }>(`${base(workspace)}/repositories/${encodeURIComponent(repository)}/git`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, branch }),
  });
export const startBuild = (workspace: string, body: { scope: 'all' } | { scope: 'repositories'; repositories: string[] }) =>
  request<BuildTask>(`${base(workspace)}/builds`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
export const cancelBuild = (workspace: string, id: string) =>
  request<BuildTask>(`${base(workspace)}/builds/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
