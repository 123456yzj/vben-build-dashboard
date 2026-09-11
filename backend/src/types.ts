export interface DashboardConfig {
  port: number;
  host: string;
  targetRepoPath: string;
  protectedBranches: string[];
}

export interface CommitInfo {
  hash: string;
  author: string;
  message: string;
  date: string;
}

export interface RepoStatus {
  name: string;
  packageName: string;
  path: string;
  isGit: boolean;
  isRoot?: boolean;
  currentBranch?: string;
  commit?: CommitInfo;
  isDirty?: boolean;
  dirtyCount?: number;
  dirtyFiles?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
  allBranches?: string[];
  updatedAt?: number;
}

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  dirty?: boolean;
  message?: string;
}

export interface BuildStatus {
  status: 'idle' | 'running' | 'success' | 'failed';
  currentTask: string | null;
  startTime: number | null;
  endTime: number | null;
  pid: number | null;
}

export type WebSocketMessage =
  | { type: 'repos_updated'; data: RepoStatus[] }
  | { type: 'log'; data: string }
  | { type: 'log_clear' }
  | { type: 'build_status'; data: BuildStatus }
  | { type: 'init'; data: { status: BuildStatus; logs: string[] } };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
