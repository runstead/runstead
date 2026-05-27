import type { RuntimeBackendConfigEnv } from "@runstead/runtime";

import type { TeamControlPlaneCheckLiveBackend } from "./team-control-plane-live.js";
import type { TeamControlPlanePostgresClientFactory } from "./team-control-plane-runner.js";

export type TeamControlPlaneAssertionStatus = "pass" | "fail" | "warn";

export interface TeamControlPlaneAssertion {
  id: string;
  title: string;
  status: TeamControlPlaneAssertionStatus;
  message: string;
  evidence: string[];
}

export interface TeamControlPlaneCheckOptions {
  cwd?: string;
  env?: RuntimeBackendConfigEnv;
  live?: boolean;
  liveMigrate?: boolean;
  liveRequireInitialized?: boolean;
  schema?: string;
  postgresClientFactory?: TeamControlPlanePostgresClientFactory;
  now?: Date;
}

export interface TeamControlPlaneCheckResult {
  cwd: string;
  root: string;
  initialized: boolean;
  backend: string;
  storageUri: string;
  artifactBaseUri?: string;
  passed: boolean;
  assertions: TeamControlPlaneAssertion[];
  setupBlockers: string[];
  warnings: string[];
  nextActions: string[];
  liveBackend?: TeamControlPlaneCheckLiveBackend;
}
