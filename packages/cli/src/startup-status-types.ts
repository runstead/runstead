import type { StartupGateStage } from "./startup-evidence.js";

export interface StartupStatusOptions {
  cwd?: string;
  domain?: string;
  now?: Date;
}

export interface StartupStatusResult {
  root: string;
  stateDb: string;
  domain: string;
  generatedAt: string;
  currentStage: StartupGateStage;
  gates: StartupStatusGate[];
  readiness?: StartupStatusReadinessVerdict;
  execution: StartupStatusExecutionSummary;
  evidence: StartupStatusEvidenceSummary;
  nextAction: StartupStatusNextAction;
}

export interface StartupStatusReadinessVerdict {
  runId: string;
  target: string;
  verdict: string;
  blockers: string[];
  completedAt?: string;
}

export interface StartupStatusExecutionSummary {
  recoveredTasks: StartupStatusRecoveredTask[];
  interruptedTasks: StartupStatusInterruptedTask[];
}

export interface StartupStatusRecoveredTask {
  id: string;
  previousStatus: string;
  status: string;
}

export interface StartupStatusInterruptedTask {
  id: string;
  status: string;
  type: string;
  updatedAt: string;
  reason: string;
}

export interface StartupStatusGate {
  stage: StartupGateStage;
  status: "passed" | "blocked";
  blockers: string[];
  warnings: string[];
}

export interface StartupStatusEvidenceSummary {
  total: number;
  latest?: StartupStatusEvidenceItem;
  staleSources: StartupStatusStaleSource[];
  sourceKinds: string[];
}

export interface StartupStatusEvidenceItem {
  id: string;
  type: string;
  summary?: string;
  createdAt: string;
}

export interface StartupStatusStaleSource {
  evidenceId: string;
  type: string;
  uri: string;
  capturedAt: string;
  freshnessDays: number;
  ageDays: number;
}

export interface StartupStatusNextAction {
  command: string;
  reason: string;
}
