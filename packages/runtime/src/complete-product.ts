export type RuntimeCompleteProductStatus = "complete" | "incomplete";
export type RuntimeCompleteProductCriterionStatus = "passed" | "blocked";

export interface RuntimeCompleteProductCriterion {
  id: string;
  title: string;
  status: RuntimeCompleteProductCriterionStatus;
  severity: "critical" | "major";
  evidence: string[];
  missing: string[];
  nextAction: string;
}

export interface RuntimeCompleteProductCriterionInput {
  id: string;
  title: string;
  passed: boolean;
  severity: RuntimeCompleteProductCriterion["severity"];
  evidence: string[];
  missing: string[];
  nextAction: string;
}

export interface RuntimeCompleteProductArtifactTruthInput {
  completeCheckMarkdown: string;
  completeCheckJson: string;
  evidenceId: string;
  eventId: string;
}

export function defineRuntimeCompleteProductCriterion(
  input: RuntimeCompleteProductCriterionInput
): RuntimeCompleteProductCriterion {
  return {
    id: input.id,
    title: input.title,
    status: input.passed ? "passed" : "blocked",
    severity: input.severity,
    evidence: uniqueNonEmpty(input.evidence),
    missing: uniqueNonEmpty(input.missing),
    nextAction: input.nextAction
  };
}

export function runtimeCompleteProductArtifactCriterion(
  surfaces: RuntimeCompleteProductArtifactTruthInput
): RuntimeCompleteProductCriterion {
  return defineRuntimeCompleteProductCriterion({
    id: "artifact_truth",
    title: "Artifact State Evidence Event Truth",
    passed:
      surfaces.evidenceId.trim().length > 0 &&
      surfaces.eventId.trim().length > 0 &&
      surfaces.completeCheckMarkdown.trim().length > 0 &&
      surfaces.completeCheckJson.trim().length > 0,
    severity: "critical",
    evidence: [
      surfaces.completeCheckMarkdown,
      surfaces.completeCheckJson,
      surfaces.evidenceId,
      surfaces.eventId
    ],
    missing: [],
    nextAction:
      "use the generated markdown, JSON, evidence, and event as the review source of truth"
  });
}

export function runtimeCompleteProductStatus(
  criteria: RuntimeCompleteProductCriterion[]
): RuntimeCompleteProductStatus {
  return criteria.every((criterion) => criterion.status === "passed")
    ? "complete"
    : "incomplete";
}

export function runtimeCompleteProductScore(
  criteria: RuntimeCompleteProductCriterion[]
): number {
  if (criteria.length === 0) {
    return 0;
  }

  return (
    Math.round(
      (criteria.filter((criterion) => criterion.status === "passed").length /
        criteria.length) *
        100
    ) / 100
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
