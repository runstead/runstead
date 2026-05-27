import type { StartupGateEvidenceArtifact } from "./startup-gate-artifacts.js";
import type { StartupGateStage } from "./startup-evidence-types.js";
import type { StartupGateFindingSeverity } from "./startup-gate-rules.js";

export interface StartupGateTaskRow {
  id: string;
  type: string;
  status: string;
}

export interface StartupGateEvidenceRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

export interface StartupGatePreviousEvent {
  eventId: string;
  blockers: string[];
}

export interface StartupGateFinding {
  id: string;
  severity: StartupGateFindingSeverity;
  message: string;
  explanation: string;
  remediationTask: string;
  waived: boolean;
  waiverEvidenceId?: string;
}

export interface StartupGateWaiver {
  evidenceId: string;
  blocker: string;
  owner: string;
  reason: string;
  expiresAt: string;
}

export interface StartupGateDiff {
  previousEventId?: string;
  addedBlockers: string[];
  resolvedBlockers: string[];
}

export interface StartupGateEvaluationContext {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}

export interface StartupGateEvaluationInput extends StartupGateEvaluationContext {
  previousEvent?: StartupGatePreviousEvent;
}

export interface StartupGateEvaluationResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  findings: StartupGateFinding[];
  waivedBlockers: StartupGateWaiver[];
  diff: StartupGateDiff;
}
