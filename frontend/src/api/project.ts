import { request } from './request';
import type { GitAction } from '../types/git';
import type { Project, ProjectDetail } from '../types/project';
import type { BuildRecord } from '../types/build';

export function getProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects');
}

export function getProjectDetail(name: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/api/projects/${encodeURIComponent(name)}`);
}

export function gitAction(name: string, action: GitAction, branch?: string): Promise<{ git: Project['git'] }> {
  return request(`/api/projects/${encodeURIComponent(name)}/git`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, branch }),
  });
}

export function buildProject(name: string): Promise<BuildRecord> {
  return request(`/api/projects/${encodeURIComponent(name)}/build`, { method: 'POST' });
}
