export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitRunner = (
  args: string[],
  options: { cwd: string; timeoutMs?: number }
) => Promise<GitCommandResult>;

export interface RunsteadBranchNameOptions {
  taskId: string;
  slug?: string;
  prefix?: string;
}

export interface CreateGitBranchOptions {
  cwd?: string;
  branchName: string;
  baseRef?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface CreateGitBranchResult {
  cwd: string;
  branchName: string;
  baseRef?: string;
}

export interface PushGitBranchOptions {
  cwd?: string;
  branchName: string;
  remote?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface PushGitBranchResult {
  cwd: string;
  branchName: string;
  remote: string;
  stdout: string;
}

export interface ListGitChangedFilesOptions {
  cwd?: string;
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface ListGitChangedFilesResult {
  cwd: string;
  changedFiles: string[];
  trackedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  excludedFiles: string[];
}

export interface CommitGitChangesOptions {
  cwd?: string;
  message: string;
  changedFiles: string[];
  timeoutMs?: number;
  runner?: GitRunner;
}

export interface CommitGitChangesResult {
  cwd: string;
  message: string;
  commitSha: string;
  changedFiles: string[];
  committedFiles: string[];
  stdout: string;
}
