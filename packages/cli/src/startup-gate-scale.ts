import {
  arrayHasString,
  hasNonEmptyString,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import type { StartupGateEvidenceRow } from "./startup-gate-types.js";

export function scaleBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return [
    ...(hasEvidenceType(evidence, "startup_founder_bottleneck")
      ? []
      : ["founder bottleneck map is missing"]),
    ...founderBottleneckAgingBlockers(evidence, artifacts, checkedAt),
    ...(hasEvidenceType(evidence, "startup_workflow_registry")
      ? []
      : ["workflow registry is missing"]),
    ...(hasEvidenceType(evidence, "startup_delegation_policy")
      ? []
      : ["delegation policy is missing"]),
    ...delegationPolicyConstraintBlockers(evidence, artifacts),
    ...(hasEvidenceType(evidence, "startup_institutional_memory")
      ? []
      : ["institutional memory evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_schedule")
      ? []
      : ["scale report schedule is missing"]),
    ...(hasEvidenceType(evidence, "startup_ops_report")
      ? []
      : ["recurring ops report is missing"]),
    ...(hasEvidenceType(evidence, "startup_integration_map")
      ? []
      : ["integration depth map is missing"]),
    ...integrationDepthSignalBlockers(evidence, artifacts),
    ...(hasEvidenceType(evidence, "startup_ops_sop")
      ? []
      : ["ops SOP evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_support_triage")
      ? []
      : ["support triage evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_gtm_artifact")
      ? []
      : ["GTM artifact verification is missing"]),
    ...gtmClaimBindingBlockers(evidence, artifacts)
  ];
}

function founderBottleneckAgingBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return evidence
    .filter((item) => item.type === "startup_founder_bottleneck")
    .filter((item) => {
      const content = parsedArtifactContent(artifacts.get(item.id));

      if (!isRecord(content) || content.status === "handoff-complete") {
        return false;
      }

      return (
        typeof content.handoffDueDate === "string" &&
        Date.parse(content.handoffDueDate) < Date.parse(checkedAt)
      );
    })
    .map(() => "founder bottleneck handoff is overdue");
}

function delegationPolicyConstraintBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_delegation_policy");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));

  return isRecord(content) &&
    arrayHasString(content.allowedAgents) &&
    arrayHasString(content.constrainedTaskTypes)
    ? []
    : ["delegation policy must define allowed agents and constrained task types"];
}

function integrationDepthSignalBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_integration_map");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));
  const hasAdoptionSignal =
    isRecord(content) &&
    (arrayHasString(content.adoptionSignals) || arrayHasString(content.lockInSignals));
  const hasWorkflowSignal =
    isRecord(content) &&
    (arrayHasString(content.workflowSignals) ||
      arrayHasString(content.automationCoverage));

  return hasAdoptionSignal && hasWorkflowSignal
    ? []
    : ["integration depth map needs adoption and workflow signals"];
}

function gtmClaimBindingBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === "startup_gtm_artifact");

  if (rows.length === 0) {
    return [];
  }

  const content = parsedArtifactContent(artifacts.get(rows[0]?.id ?? ""));

  return isRecord(content) &&
    arrayHasString(content.evidenceRefs) &&
    hasNonEmptyString(content.productState) &&
    content.productState !== "unrecorded"
    ? []
    : ["GTM claim must bind to evidence refs and recorded product state"];
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}
