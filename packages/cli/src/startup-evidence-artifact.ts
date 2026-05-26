import type { Evidence, JsonObject } from "@runstead/core";

import type { StartupEvidenceSource } from "./startup-evidence-sources.js";
import type {
  StartupEvidenceType,
  StartupGateStage
} from "./startup-evidence-types.js";

const STARTUP_DOMAIN = "ai-native-startup";

export interface StartupEvidenceArtifactForEvent {
  evidenceType: StartupEvidenceType;
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
}

export interface StartupEvidenceRemediationOptions {
  owner?: string;
  remediationTask?: string;
  acceptanceCriteria?: string;
}

export function startupEvidenceSubject(artifact: StartupEvidenceArtifactForEvent): {
  subjectType: string;
  subjectId: string;
} {
  if (artifact.associations.goalId !== undefined) {
    return {
      subjectType: "goal",
      subjectId: artifact.associations.goalId
    };
  }

  if (artifact.associations.hypothesisId !== undefined) {
    return {
      subjectType: "hypothesis",
      subjectId: artifact.associations.hypothesisId
    };
  }

  if (artifact.associations.decisionId !== undefined) {
    return {
      subjectType: "decision",
      subjectId: artifact.associations.decisionId
    };
  }

  return {
    subjectType: "startup",
    subjectId: STARTUP_DOMAIN
  };
}

export function startupEvidenceEventPayload(
  evidence: Evidence,
  artifact: StartupEvidenceArtifactForEvent
): JsonObject {
  return {
    evidenceId: evidence.id,
    evidenceType: evidence.type,
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    uri: evidence.uri,
    hash: evidence.hash,
    summary: evidence.summary,
    startupEvidenceType: artifact.evidenceType,
    sourceRefs: artifact.sourceRefs,
    sources: artifact.sources,
    provenance: artifact.provenance,
    associations: artifact.associations
  };
}

export function startupEvidenceRemediation(options: StartupEvidenceRemediationOptions):
  | {
      owner: string;
      task: string;
      acceptanceCriteria: string;
    }
  | undefined {
  const values = [options.owner, options.remediationTask, options.acceptanceCriteria];

  if (values.every((value) => value === undefined)) {
    return undefined;
  }

  if (
    options.owner === undefined ||
    options.remediationTask === undefined ||
    options.acceptanceCriteria === undefined
  ) {
    throw new Error(
      "startup evidence remediation requires --owner, --remediation-task, and --acceptance-criteria"
    );
  }

  return {
    owner: options.owner,
    task: options.remediationTask,
    acceptanceCriteria: options.acceptanceCriteria
  };
}
