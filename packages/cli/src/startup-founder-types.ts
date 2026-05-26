import type { RuntimeExecutionSemantics } from "@runstead/runtime";

import type {
  LocalAgentWorkerKind,
  RunLocalAgentTaskOptions,
  RunLocalAgentTaskResult
} from "./local-agent.js";
import type { InitPolicyProfile } from "./init.js";
import type { LaunchReadinessTarget } from "./launch-readiness-report.js";
import type { StartupDependencyApprovalBoundary } from "./startup-dependency-approval.js";
import type {
  GenerateMeasurementFrameworkResult,
  GenerateRepoReadinessAuditResult,
  GenerateScaleOpsReportResult,
  GenerateSecurityBaselineResult,
  GenerateStartupContextResult,
  StartupInitResult
} from "./startup-automation.js";
import type { StartupGateCheckResult } from "./startup-evidence.js";
import type { StartupRepoOnboardingResult } from "./startup-repo-onboarding.js";
import type {
  StartupAppType,
  StartupScaffoldProfile,
  StartupScaffoldTemplate
} from "./startup-scaffold-profile.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface StartupFounderFlowOptions {
  cwd?: string;
  profile?: InitPolicyProfile;
  force?: boolean;
  writeCi?: boolean;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  writeTrackedContext?: boolean;
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
  target?: LaunchReadinessTarget;
  appTemplate?: StartupScaffoldTemplate;
  appType?: StartupAppType;
  scaffoldProfile?: StartupScaffoldProfile;
  now?: Date;
}

export interface StartupOnboardResult {
  root: string;
  repo: StartupRepoOnboardingResult;
  init: StartupInitResult;
  context: StartupGeneratedStep<GenerateStartupContextResult>;
  measurement: StartupGeneratedStep<GenerateMeasurementFrameworkResult>;
  onboardingFiles: string[];
  nextCommands: string[];
}

export interface StartupBuildMvpOptions extends StartupFounderFlowOptions {
  worker?: LocalAgentWorkerKind;
  model?: string;
  prompt?: string;
  dependencyPolicy?: string;
  allowedDependencies?: string[];
  maxAttempts?: number;
  maxTurns?: number;
  workerRunner?: WorkerProcessRunner;
  onWorkerProgress?: RunLocalAgentTaskOptions["onWorkerProgress"];
  workerProgressIntervalMs?: number;
}

export interface StartupBuildMvpResult {
  root: string;
  worker: LocalAgentWorkerKind;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  execution: RuntimeExecutionSemantics;
  maxTurns: number;
  dependencyApproval: StartupDependencyApprovalBoundary;
  verifierRun: StartupMvpVerifierRun;
  attempts: StartupBuildMvpAttempt[];
  gate: StartupGateCheckResult;
  nextCommands: string[];
}

export interface StartupBuildMvpAttempt {
  attempt: number;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  execution: RuntimeExecutionSemantics;
  verifierRun: StartupMvpVerifierRun;
}

export interface StartupLaunchCheckResult {
  root: string;
  readiness: GenerateRepoReadinessAuditResult;
  security: GenerateSecurityBaselineResult;
  gate: StartupGateCheckResult;
  reportPath: string;
  status: "launch_ready" | "blocked";
  blockers: string[];
  nextCommands: string[];
}

export interface StartupScaleCheckResult {
  root: string;
  opsReport: GenerateScaleOpsReportResult;
  gate: StartupGateCheckResult;
  nextCommands: string[];
}

export interface StartupGeneratedStep<T> {
  status: "generated" | "skipped";
  result?: T;
  reason?: string;
}

export type StartupMvpVerifierRun =
  | {
      status: StartupMvpVerifierTaskStatus;
      taskId: string;
      commandResults: RunTaskVerifierCommandResult[];
    }
  | {
      status: "skipped";
      reason: string;
    };

export type StartupMvpVerifierTaskStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "waiting_approval";
