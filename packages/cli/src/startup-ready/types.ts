import type {
  ReadinessEvidenceRequirement,
  RuntimeExecutionSemantics
} from "@runstead/runtime";

import type { LocalAgentWorkerKind } from "../local-agent.js";
import type {
  ResolvedStartupWorkerGovernanceProfile,
  StartupBuildMvpOptions,
  StartupWorkerGovernanceProfile
} from "../startup-founder-flow.js";
import type {
  StartupAppType,
  StartupScaffoldProfile,
  StartupScaffoldTemplate
} from "../startup-scaffold-profile.js";

export type StartupReadyStage = "mvp" | "launch" | "scale" | "complete";
export type StartupReadyTarget = "local" | "staging" | "production";
export type StartupReadinessRunStatus =
  | "planned"
  | "running"
  | "completed"
  | "blocked"
  | "failed";
export type StartupReadinessPhaseStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked"
  | "failed"
  | "skipped";
export type StartupReadinessDirtyState = "clean" | "dirty" | "unknown";
export interface StartupReadinessDirtyBreakdown {
  productDirty: boolean;
  runsteadGeneratedDirty: boolean;
  ignoredRuntimeDirty: boolean;
  dependencyDirty: boolean;
  unknownDirty: boolean;
  productFiles: string[];
  runsteadGeneratedFiles: string[];
  ignoredRuntimeFiles: string[];
  dependencyFiles: string[];
  unknownFiles: string[];
}
export const STARTUP_READINESS_EVIDENCE_TIERS = [
  "synthetic_smoke",
  "local_manual",
  "local_command",
  "ci_verified",
  "staging_deployment",
  "production_deployment",
  "real_user_analytics",
  "support_ticket",
  "security_scan"
] as const;

export type StartupReadinessEvidenceTier =
  (typeof STARTUP_READINESS_EVIDENCE_TIERS)[number];
export type StartupReadinessVerdict =
  | "not_evaluated"
  | "local_launch_ready"
  | "local_launch_blocked"
  | "staging_launch_ready"
  | "staging_launch_blocked"
  | "public_launch_ready"
  | "public_launch_blocked";

export interface StartupReadyOptions {
  cwd?: string;
  stage?: StartupReadyStage;
  target?: StartupReadyTarget;
  worker?: LocalAgentWorkerKind;
  governanceProfile?: StartupWorkerGovernanceProfile;
  plan?: boolean;
  resumeRunId?: string;
  writeCi?: boolean;
  ci?: boolean;
  refreshContext?: boolean;
  writeTrackedContext?: boolean;
  interactive?: boolean;
  guided?: boolean;
  interactiveAnswers?: Partial<StartupReadyInteractiveAnswers>;
  appTemplate?: StartupScaffoldTemplate;
  appType?: StartupAppType;
  maxAttempts?: number;
  forceBuild?: boolean;
  workerRunner?: StartupBuildMvpOptions["workerRunner"];
  onProgress?: (event: StartupReadyProgressEvent) => void;
  now?: Date;
}

export type StartupReadyProgressEventStatus =
  | "started"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export interface StartupReadyProgressEvent {
  runId: string;
  phaseId?: string;
  phaseTitle?: string;
  status: StartupReadyProgressEventStatus;
  message: string;
  timestamp: string;
  evidenceIds?: string[];
  artifacts?: string[];
  blockers?: string[];
}

export interface StartupReadyInteractiveAnswers {
  architecturePrinciple: string;
  technicalConstraint: string;
  acceptedDebt: string;
  activationMetric: string;
  retentionMetric: string;
  day7Metric: string;
  day30Metric: string;
  falsePositiveMetric: string;
}

export interface StartupReadyPlan {
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  scaffoldProfile?: StartupScaffoldProfile;
  runsteadInitialized: boolean;
  extensions: StartupReadyPlanExtensions;
  phases: StartupReadyPlanPhase[];
}

export interface StartupReadyPlanExtensions {
  discoveredPaths: string[];
  loaded: string[];
  issues: string[];
}

export interface StartupReadyPlanPhase {
  id: string;
  title: string;
  status: "pending" | "blocked" | "skipped";
  blockers: string[];
  nextAction?: string;
}

export interface StartupReadinessRun {
  schemaVersion: 1;
  id: string;
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  scaffoldProfile?: StartupScaffoldProfile;
  status: StartupReadinessRunStatus;
  phases: StartupReadinessRunPhase[];
  evidenceIds: string[];
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
  evidenceRequirements: ReadinessEvidenceRequirement[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
  verdict: StartupReadinessVerdict;
  verdictBlockers: string[];
  reportPaths: string[];
  guidedFlow: StartupReadyGuidedStep[];
  operatorCommands: StartupReadyOperatorCommand[];
  startedAt: string;
  completedAt?: string;
  gitHead?: string;
  dirtyState: StartupReadinessDirtyState;
  dirtyBreakdown?: StartupReadinessDirtyBreakdown;
  codeFingerprint?: string;
}

export interface StartupReadinessRunPhase {
  id: string;
  title: string;
  status: StartupReadinessPhaseStatus;
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
  warnings?: string[];
  execution?: RuntimeExecutionSemantics;
  nextAction?: string;
}

export type StartupReadyGuidedResolution = "runstead" | "agent" | "manual";

export interface StartupReadyGuidedStep {
  id: string;
  title: string;
  status: "ready" | "blocked" | "next";
  resolution: StartupReadyGuidedResolution;
  why: string;
  nextAction: string;
  command?: string;
  blockers: string[];
}

export type StartupReadyOperatorCommandKind =
  | "recover"
  | "resume"
  | "rerun"
  | "ci"
  | "dashboard"
  | "complete_check";

export interface StartupReadyOperatorCommand {
  kind: StartupReadyOperatorCommandKind;
  title: string;
  command: string;
  when: string;
}

export interface PersistedStartupReadinessRun {
  run: StartupReadinessRun;
  path: string;
}

export interface RunStartupReadyResult extends PersistedStartupReadinessRun {
  plan: StartupReadyPlan;
}
