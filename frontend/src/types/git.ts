export interface GitInfo {
  branch: string;
  hash: string;
  message: string;
  clean: boolean;
  localBranches: string[];
  remoteBranches: string[];
}

export type GitAction = 'fetch' | 'pull' | 'checkout';
