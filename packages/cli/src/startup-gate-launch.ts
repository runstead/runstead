import {
  hasDecisionAssociation,
  hasNonEmptyString,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import type {
  StartupGateEvidenceRow,
  StartupGateTaskRow
} from "./startup-gate-evaluation.js";
import { uiValidationBlockers } from "./startup-gate-ui.js";
import { hasStructuredMetricEvidence } from "./startup-gate-validation.js";

export function launchBlockers(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
}): string[] {
  return [
    ...(hasMeasurementFramework(input) ? [] : ["measurement framework is missing"]),
    ...(hasStructuredMetricEvidence(input.evidence, input.artifacts)
      ? []
      : ["metric snapshot with source, threshold, and current value is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_repo_readiness") ||
    hasCompletedTask(input.tasks, "inspect_repo_readiness")
      ? []
      : ["repo readiness audit is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_security_baseline")
      ? []
      : ["security baseline is missing"]),
    ...(hasPassingCommandOutput(input.evidence, input.artifacts)
      ? []
      : ["passing verifier command evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_migration_plan")
      ? []
      : ["migration plan evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_rollback_plan")
      ? []
      : ["rollback plan evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_observability")
      ? []
      : ["observability evidence is missing"]),
    ...(hasEvidenceType(input.evidence, "startup_founder_bottleneck")
      ? []
      : ["founder bottleneck audit is missing"]),
    ...launchEvidenceQualityBlockers(input.evidence, input.artifacts),
    ...uiValidationBlockers(input.evidence, input.artifacts),
    ...acceptedDebtDecisionBlockers(input.evidence, input.artifacts)
  ];
}

export function hasPassingCommandOutput(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  return evidence
    .filter((item) => item.type === "command_output")
    .some((item) => {
      const result = artifacts.get(item.id)?.result;

      return (
        isRecord(result) &&
        result.exitCode === 0 &&
        result.timedOut === false &&
        result.forceKilled === false
      );
    });
}

function hasMeasurementFramework(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
}): boolean {
  return (
    hasEvidenceType(input.evidence, "startup_measurement_framework") ||
    hasCompletedTask(input.tasks, "define_measurement_framework")
  );
}

function launchEvidenceQualityBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return [
    "startup_migration_plan",
    "startup_rollback_plan",
    "startup_observability"
  ].flatMap((type) => {
    const rows = evidence.filter((item) => item.type === type);

    if (rows.length === 0) {
      return [];
    }

    return rows.some((item) => hasRemediationQuality(artifacts.get(item.id)))
      ? []
      : [
          `${startupEvidenceLabel(type)} needs owner, remediation task, and acceptance criteria`
        ];
  });
}

function acceptedDebtDecisionBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const undecidedDebt = evidence
    .filter((item) => item.type === "startup_acceptable_debt")
    .filter((item) => !hasDecisionAssociation(artifacts.get(item.id)));

  return undecidedDebt.length === 0
    ? []
    : ["accepted debt requires an explicit decision association"];
}

function hasRemediationQuality(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);
  const remediation = artifact?.remediation;

  return (
    hasRemediationQualityFields(content) || hasRemediationQualityFields(remediation)
  );
}

function hasRemediationQualityFields(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasNonEmptyString(value.owner) &&
    hasNonEmptyString(
      value.remediationTask === undefined ? value.task : value.remediationTask
    ) &&
    hasNonEmptyString(value.acceptanceCriteria)
  );
}

function startupEvidenceLabel(type: string): string {
  return type.replace(/^startup_/, "").replaceAll("_", " ");
}

function hasCompletedTask(tasks: StartupGateTaskRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}
