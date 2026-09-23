import type { GitInfo } from './git';
import type { BuildTask } from './build';

export interface Workspace {
  name: string;
  path: string;
  repositoryDir: string;
  depth: number;
}

export interface Repository {
  workspace: string;
  name: string;
  path: string;
  git: GitInfo | null;
  busy: boolean;
  buildable: boolean;
  error?: string;
}

export interface WorkspaceDetail extends Workspace {
  build: { all: { command: string; args: string[] } };
  busy: boolean;
}

export interface TaskDetail extends BuildTask {
  logs: { stream: string; text: string; buildId: string }[];
}
