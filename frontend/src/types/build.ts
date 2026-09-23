export type BuildState = 'pending' | 'running' | 'success' | 'failed';

export interface BuildRecord {
  id: string;
  project: string;
  branch: string;
  time: string;
  status: BuildState;
  duration: number | null;
}

export interface BuildLog {
  stream: string;
  text: string;
  buildId: string;
}
