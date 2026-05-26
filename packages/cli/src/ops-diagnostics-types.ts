import type { DaemonHeartbeatStatus } from "./daemon.js";

export interface GenerateOpsDiagnosticsOptions {
  cwd?: string;
  includeStateBackup?: boolean;
  retentionDays?: number;
  now?: Date;
}

export interface OpsDiagnosticsBundleResult {
  root: string;
  stateDb: string;
  markdownPath: string;
  jsonPath: string;
  stateBackupPath?: string;
  summary: OpsDiagnosticsSummary;
}

export interface OpsDiagnosticsSummary {
  generatedAt: string;
  doctorOk: boolean;
  failedChecks: string[];
  daemon?: DaemonHeartbeatStatus;
  managerLock: ManagerLockSnapshot;
  stateTables: Record<string, number>;
  artifacts: Record<string, ArtifactDirectorySnapshot>;
  retention: {
    retentionDays: number;
    cleanupCandidates: string[];
  };
  timeoutProfiles: Record<string, string>;
}

export interface ManagerLockSnapshot {
  path: string;
  status: "missing" | "present" | "unreadable";
  ownerId?: string;
  heartbeatAt?: string;
}

export interface ArtifactDirectorySnapshot {
  path: string;
  files: number;
  bytes: number;
}
