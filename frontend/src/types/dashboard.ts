export interface AppConfig {
  targetRepoPath: string;
  protectedBranches: string[];
}

export interface RepoCommit {
  hash: string;
  author: string;
  message: string;
  date: string;
}

export interface Repository {
  name: string;
  packageName: string;
  path: string;
  isGit: boolean;
  isRoot: boolean;
  currentBranch: string;
  commit: RepoCommit;
  isDirty: boolean;
  dirtyCount: number;
  dirtyFiles: string[];
  localBranches: string[];
  remoteBranches: string[];
  allBranches: string[];
  updatedAt: number;
}

export type BuildState = 'idle' | 'running' | 'success' | 'failed';

export interface BuildStatus {
  status: BuildState;
  currentTask: string | null;
  startTime: number | null;
  endTime: number | null;
  pid: number | null;
}

export type ToastType = 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export type BranchTab = 'all' | 'local' | 'remote';

export interface BranchItem {
  key: string;
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

export interface BranchPickerState {
  show: boolean;
  repo: Repository | null;
  search: string;
  tab: BranchTab;
}

export interface DirtyModalState {
  show: boolean;
  repo: Repository | null;
  targetBranch: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryPickerState {
  show: boolean;
  loading: boolean;
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
  isProject: boolean;
  error: string;
}

export interface FieldErrors {
  targetRepoPath: string;
  protectedBranches: string;
}

export type FieldErrorKey = keyof FieldErrors;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  stderr?: string;
  repos?: Repository[] | null;
  source?: string;
  dirty?: boolean;
  field?: FieldErrorKey | null;
}

export type DashboardMessage =
  | { type: 'init'; data: { status: BuildStatus; logs: string[] } }
  | { type: 'log'; data: string }
  | { type: 'log_clear' }
  | { type: 'build_status'; data: BuildStatus }
  | { type: 'repos_updated'; data: Repository[] };
