import type { BuildLog, BuildRecord } from './build';
import type { GitInfo } from './git';

export interface Project {
  name: string;
  path: string;
  buildCommand: string;
  git: GitInfo | null;
  latestBuild: BuildRecord | null;
  error?: string;
}

export interface ProjectDetail extends Project {
  history: BuildRecord[];
  logs: BuildLog[];
  busy: boolean;
}

export type ProjectAction = 'build' | 'fetch' | 'pull' | 'checkout';
