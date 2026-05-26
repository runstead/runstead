import type { PolicyDecisionRecord } from "@runstead/core";

export interface ApprovalActionMetadata {
  filesTouched: string[];
  dependencyImpact: {
    kind: string;
    files: string[];
  };
  diffHash?: string;
  riskClass?: string;
  canonicalSignature?: string;
  riskSummary?: string;
}

export function approvalActionMetadata(
  policyDecision: PolicyDecisionRecord | undefined
): ApprovalActionMetadata {
  const action = isRecord(policyDecision?.action) ? policyDecision.action : {};
  const context = isRecord(action.context) ? action.context : {};
  const dependencyImpact = isRecord(context.dependencyImpact)
    ? context.dependencyImpact
    : {};

  return {
    filesTouched: stringArrayValue(context.filesTouched),
    dependencyImpact: {
      kind:
        typeof dependencyImpact.kind === "string" ? dependencyImpact.kind : "unknown",
      files: stringArrayValue(dependencyImpact.files)
    },
    ...(typeof context.diffHash === "string" ? { diffHash: context.diffHash } : {}),
    ...(typeof context.riskClass === "string" ? { riskClass: context.riskClass } : {}),
    ...(typeof context.canonicalSignature === "string"
      ? { canonicalSignature: context.canonicalSignature }
      : {}),
    ...(typeof context.riskSummary === "string"
      ? { riskSummary: context.riskSummary }
      : {})
  };
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
