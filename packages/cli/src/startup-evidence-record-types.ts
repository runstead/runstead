import type { Evidence, JsonObject, RunsteadEvent } from "@runstead/core";

import type {
  StartupEvidenceSource,
  StartupEvidenceSourceInput
} from "./startup-evidence-sources.js";
import type {
  StartupEvidenceType,
  StartupGateStage,
  StartupHypothesisKind,
  StartupHypothesisStatus
} from "./startup-evidence-types.js";

export interface AddStartupEvidenceOptions {
  cwd?: string;
  type: string;
  summary: string;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  content?: string;
  goalId?: string;
  hypothesisId?: string;
  decisionId?: string;
  gate?: StartupGateStage;
  blocker?: string;
  owner?: string;
  remediationTask?: string;
  acceptanceCriteria?: string;
  now?: Date;
}

export interface AddStartupEvidenceResult {
  root: string;
  stateDb: string;
  evidence: Evidence;
  event: RunsteadEvent;
  artifact: StartupEvidenceArtifact;
  artifactPath: string;
  artifactManifestPath: string;
}

export interface AddStartupHypothesisOptions {
  cwd?: string;
  kind: StartupHypothesisKind;
  statement: string;
  status?: StartupHypothesisStatus;
  sourceRefs?: string[];
  goalId?: string;
  now?: Date;
}

export interface RecordStartupManualChangeOptions {
  cwd?: string;
  operator: string;
  reason: string;
  diffSummary: string;
  filesTouched?: string[];
  commandsRerun?: string[];
  evidenceRefs?: string[];
  sourceRefs?: string[];
  goalId?: string;
  gate?: StartupGateStage;
  blocker?: string;
  now?: Date;
}

export interface StartupEvidenceArtifact {
  schemaVersion: 1;
  createdAt: string;
  evidenceType: StartupEvidenceType;
  summary: string;
  sourceRefs: string[];
  sources: StartupEvidenceSource[];
  provenance: JsonObject;
  associations: {
    goalId?: string;
    hypothesisId?: string;
    decisionId?: string;
    gate?: StartupGateStage;
    blocker?: string;
  };
  remediation?: {
    owner: string;
    task: string;
    acceptanceCriteria: string;
  };
  content?: string;
}

export interface RecordStartupGateDecisionOptions {
  cwd?: string;
  domain?: string;
  stage: StartupGateStage;
  decision: "launch" | "no_launch" | "launch_with_accepted_debt" | "waive_blocker";
  reason: string;
  comment?: string;
  owner?: string;
  blocker?: string;
  expiresAt?: string;
  now?: Date;
}
