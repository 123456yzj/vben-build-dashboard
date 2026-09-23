export type BuildState = 'pending' | 'running' | 'success' | 'failed';
export interface BuildStep {
  repository: string | null;
  branch: string;
  status: BuildState;
  duration: number | null;
}
export interface BuildTask {
  id: string;
  workspace: string;
  scope: 'all' | 'repositories';
  repositories: string[];
  time: string;
  status: BuildState;
  duration: number | null;
  steps: BuildStep[];
}
