export class OperationLocks {
  private held = new Set<string>();

  isBusy(workspace: string, repository?: string): boolean {
    return this.held.has(`w:${workspace}`) || (repository !== undefined && this.held.has(`r:${workspace}:${repository}`));
  }

  acquire(workspace: string, repositories: string[], all = false): () => void {
    if (this.isBusy(workspace) || (all && [...this.held].some((key) => key.startsWith(`r:${workspace}:`))) ||
      repositories.some((name) => this.isBusy(workspace, name))) {
      throw Object.assign(new Error('目标正在执行操作'), { statusCode: 409 });
    }
    const keys = all ? [`w:${workspace}`] : repositories.map((name) => `r:${workspace}:${name}`);
    keys.forEach((key) => this.held.add(key));
    return () => keys.forEach((key) => this.held.delete(key));
  }
}
