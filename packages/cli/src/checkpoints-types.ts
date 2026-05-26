export interface WorkspaceCheckpoint {
  id: string;
  workspace: string;
  checkpointDir: string;
  metadataPath: string;
  statusPath: string;
  patchPath: string;
  untrackedDir: string;
  untrackedFiles: string[];
  head?: string;
  createdAt: string;
}

export interface CreateWorkspaceCheckpointOptions {
  workspace: string;
  checkpointDir: string;
  now?: Date;
  runner?: GitCheckpointRunner;
  gitTimeoutMs?: number;
  gitMaxOutputBytes?: number;
}

export type GitCheckpointRunner = (
  args: string[],
  options: { cwd: string; maxOutputBytes: number; timeoutMs: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface ReadWorkspaceCheckpointOptions {
  workspace: string;
  checkpointDir: string;
  checkpointId: string;
}

export interface RestoreWorkspaceCheckpointOptions extends ReadWorkspaceCheckpointOptions {
  runner?: GitCheckpointRunner;
  allowHeadMismatch?: boolean;
  gitTimeoutMs?: number;
  gitMaxOutputBytes?: number;
}

export interface RestoreWorkspaceCheckpointResult {
  checkpoint: WorkspaceCheckpoint;
  currentHead?: string;
  restoredTrackedPatch: boolean;
  restoredUntrackedFiles: string[];
  removedUntrackedFiles: string[];
}

export interface RecordWorkspaceCheckpointRestoreEventOptions {
  stateDb: string;
  result: RestoreWorkspaceCheckpointResult;
  actor?: string;
  now?: Date;
}

export interface RecordWorkspaceCheckpointCreatedEventOptions {
  stateDb: string;
  checkpoint: WorkspaceCheckpoint;
  actor?: string;
  now?: Date;
}
