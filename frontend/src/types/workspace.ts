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
  buildScript: string | null;
  error?: string;
}

export interface WorkspaceDetail extends Workspace {
  build: { all: string | null };
  busy: boolean;
}

export interface TaskDetail extends BuildTask {
  logs: BuildLog[];
}

export interface BuildLog {
  stream: string;
  text: string;
  buildId: string;
  repository: string | null;
  time: string;
  sequence: number;
}
