import {
  artifactSources,
  hasDecisionAssociation,
  hasHypothesisAssociation,
  hasNonEmptyString,
  hasNonEmptyValue,
  hasSourceRefs,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import {
  explainGateBlocker,
  inferGateFindingSeverity,
  remediationTaskForBlocker,
  stableGateFindingId,
  startupGateRuleForBlocker,
  type StartupGateFindingSeverity
} from "./startup-gate-rules.js";
import {
  parseStartupHypothesisStatusValue,
  type StartupGateStage,
  type StartupHypothesisKind,
  type StartupHypothesisStatus
} from "./startup-evidence-types.js";
import { scaleBlockers } from "./startup-gate-scale.js";
import { uiValidationBlockers } from "./startup-gate-ui.js";

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

export interface StartupGateEvaluationResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  findings: StartupGateFinding[];
  waivedBlockers: StartupGateWaiver[];
  diff: StartupGateDiff;
}

export function evaluateStartupGate(input: {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
  previousEvent?: StartupGatePreviousEvent;
}): StartupGateEvaluationResult {
  const rawBlockers = gateBlockers(input);
  const waivedBlockers = activeStartupGateWaivers(input);
  const findings = startupGateFindings(input.stage, rawBlockers, waivedBlockers);
  const blockers = findings
    .filter((finding) => !finding.waived && finding.severity !== "warning")
    .map((finding) => finding.message);
  const warnings = [
    ...gateWarnings(input),
    ...findings
      .filter((finding) => finding.waived)
      .map((finding) => `waived blocker: ${finding.message}`)
  ];
  const diff = startupGateDiff(input.previousEvent, blockers);

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    findings,
    waivedBlockers,
    diff
  };
}

function gateBlockers(input: {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): string[] {
  if (input.stage === "mvp") {
    return validationBlockers(input.evidence, input.artifacts);
  }

  if (input.stage === "scale") {
    return scaleBlockers(input.evidence, input.artifacts, input.checkedAt);
  }

  if (input.stage !== "launch") {
    return [];
  }

  return launchBlockers(input);
}

function gateWarnings(input: {
  stage: StartupGateStage;
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): string[] {
  if (input.stage === "mvp") {
    return [
      ...(hasEvidenceType(input.evidence, "startup_competitor")
        ? []
        : ["competitor evidence is not recorded"]),
      ...(hasEvidenceType(input.evidence, "startup_metric") ||
      hasEvidenceType(input.evidence, "startup_metric_snapshot")
        ? []
        : ["metric evidence is not recorded"]),
      ...staleEvidenceSourceWarnings(input.evidence, input.artifacts, input.checkedAt)
    ];
  }

  if (input.stage !== "launch") {
    return staleEvidenceSourceWarnings(
      input.evidence,
      input.artifacts,
      input.checkedAt
    );
  }

  const hasVerifierEvidence = hasPassingCommandOutput(input.evidence, input.artifacts);

  return [
    ...(hasCompletedTask(input.tasks, "run_mvp_verifiers") || hasVerifierEvidence
      ? []
      : ["run_mvp_verifiers has not completed"]),
    ...(hasVerifierEvidence ||
    hasStructuredMetricEvidence(input.evidence, input.artifacts)
      ? []
      : ["no verifier or metric evidence is recorded"]),
    ...staleEvidenceSourceWarnings(input.evidence, input.artifacts, input.checkedAt)
  ];
}

function activeStartupGateWaivers(input: {
  stage: StartupGateStage;
  evidence: StartupGateEvidenceRow[];
  artifacts: Map<string, StartupGateEvidenceArtifact>;
  checkedAt: string;
}): StartupGateWaiver[] {
  return input.evidence
    .filter((item) => item.type === "startup_decision")
    .flatMap((item) => {
      const content = parsedArtifactContent(input.artifacts.get(item.id));

      if (
        !isRecord(content) ||
        content.kind !== "gate_waiver" ||
        content.gate !== input.stage ||
        !hasNonEmptyString(content.blocker) ||
        !hasNonEmptyString(content.owner) ||
        !hasNonEmptyString(content.reason) ||
        !hasNonEmptyString(content.expiresAt)
      ) {
        return [];
      }

      if (Date.parse(content.expiresAt) <= Date.parse(input.checkedAt)) {
        return [];
      }

      return [
        {
          evidenceId: item.id,
          blocker: content.blocker,
          owner: content.owner,
          reason: content.reason,
          expiresAt: content.expiresAt
        }
      ];
    });
}

function startupGateFindings(
  stage: StartupGateStage,
  blockers: string[],
  waivers: StartupGateWaiver[]
): StartupGateFinding[] {
  return blockers.map((blocker) => {
    const waiver = waivers.find((item) => item.blocker === blocker);
    const rule = startupGateRuleForBlocker(stage, blocker);

    return {
      id: rule?.id ?? stableGateFindingId(stage, blocker),
      severity: rule?.severity ?? inferGateFindingSeverity(blocker),
      message: blocker,
      explanation: rule?.explanation ?? explainGateBlocker(blocker),
      remediationTask: rule?.remediationTask ?? remediationTaskForBlocker(blocker),
      waived: waiver !== undefined,
      ...(waiver === undefined ? {} : { waiverEvidenceId: waiver.evidenceId })
    };
  });
}

function startupGateDiff(
  previous: StartupGatePreviousEvent | undefined,
  blockers: string[]
): StartupGateDiff {
  const previousBlockers = new Set(previous?.blockers ?? []);
  const currentBlockers = new Set(blockers);

  return {
    ...(previous === undefined ? {} : { previousEventId: previous.eventId }),
    addedBlockers: blockers.filter((blocker) => !previousBlockers.has(blocker)),
    resolvedBlockers: [...previousBlockers].filter(
      (blocker) => !currentBlockers.has(blocker)
    )
  };
}

function staleEvidenceSourceWarnings(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>,
  checkedAt: string
): string[] {
  return evidence.flatMap((row) => {
    const sources = artifactSources(artifacts.get(row.id));

    return sources.flatMap((source) => {
      if (
        !hasNonEmptyString(source.uri) ||
        !hasNonEmptyString(source.capturedAt) ||
        typeof source.freshnessDays !== "number"
      ) {
        return [];
      }

      const capturedAt = Date.parse(source.capturedAt);
      const ageDays = Math.floor((Date.parse(checkedAt) - capturedAt) / 86_400_000);

      return Number.isNaN(capturedAt) || ageDays <= source.freshnessDays
        ? []
        : [
            `stale evidence source for ${row.type}: ${source.uri} is ${ageDays}d old (freshness ${source.freshnessDays}d)`
          ];
    });
  });
}

function validationBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return [
    ...hypothesisGateBlockers("problem", evidence, artifacts),
    ...hypothesisGateBlockers("user", evidence, artifacts),
    ...hypothesisGateBlockers("solution", evidence, artifacts),
    ...(hasValidationEvidence(evidence, artifacts)
      ? []
      : ["customer, competitor, or metric validation evidence is missing"]),
    ...(hasEvidenceType(evidence, "startup_disconfirming")
      ? []
      : ["disconfirming evidence is missing"]),
    ...disconfirmingEvidenceBlockers(evidence, artifacts)
  ];
}

function hypothesisGateBlockers(
  kind: StartupHypothesisKind,
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  const rows = evidence.filter((item) => item.type === `startup_${kind}_hypothesis`);

  if (rows.length === 0) {
    return [`${kind} hypothesis is missing`];
  }

  const latestStatus = hypothesisStatus(artifacts.get(rows[0]?.id ?? ""));

  if (latestStatus === "validated") {
    return [];
  }

  if (latestStatus === "invalidated") {
    return [`${kind} hypothesis is invalidated`];
  }

  if (latestStatus === "needs-more-evidence") {
    return [`${kind} hypothesis needs more evidence`];
  }

  return [`${kind} hypothesis is open and not validated`];
}

function hypothesisStatus(
  artifact: StartupGateEvidenceArtifact | undefined
): StartupHypothesisStatus {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return "open";
  }

  return parseStartupHypothesisStatusValue(content.status);
}

function disconfirmingEvidenceBlockers(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): string[] {
  return evidence
    .filter((item) => item.type === "startup_disconfirming")
    .filter((item) => disconfirmingEvidenceBlocksMvp(artifacts.get(item.id)))
    .map((item) => {
      const summary = item.summary ?? "disconfirming evidence";

      return `disconfirming evidence blocks MVP build: ${summary}`;
    });
}

function disconfirmingEvidenceBlocksMvp(
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  const content = parsedArtifactContent(artifact);

  if (!isRecord(content)) {
    return false;
  }

  return content.impact === "blocker" || content.impact === "invalidates";
}

function hasValidationEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  if (hasStructuredMetricEvidence(evidence, artifacts)) {
    return true;
  }

  return ["startup_customer_interview", "startup_competitor", "startup_metric"].some(
    (type) =>
      evidence
        .filter((item) => item.type === type)
        .some((item) => hasStructuredValidationArtifact(item, artifacts.get(item.id)))
  );
}

function launchBlockers(input: {
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

function hasMeasurementFramework(input: {
  tasks: StartupGateTaskRow[];
  evidence: StartupGateEvidenceRow[];
}): boolean {
  return (
    hasEvidenceType(input.evidence, "startup_measurement_framework") ||
    hasCompletedTask(input.tasks, "define_measurement_framework")
  );
}

function hasCompletedTask(tasks: StartupGateTaskRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

function hasPassingCommandOutput(
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

function hasStructuredMetricEvidence(
  evidence: StartupGateEvidenceRow[],
  artifacts: Map<string, StartupGateEvidenceArtifact>
): boolean {
  return evidence
    .filter(
      (item) =>
        item.type === "startup_metric" || item.type === "startup_metric_snapshot"
    )
    .some((item) => {
      const content = parsedArtifactContent(artifacts.get(item.id));

      return (
        isRecord(content) &&
        hasNonEmptyString(content.source) &&
        hasNonEmptyValue(content.threshold) &&
        hasNonEmptyValue(content.current)
      );
    });
}

function hasStructuredValidationArtifact(
  row: StartupGateEvidenceRow,
  artifact: StartupGateEvidenceArtifact | undefined
): boolean {
  if (row.type === "startup_metric") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasNonEmptyString(content.source) &&
      hasNonEmptyValue(content.threshold) &&
      hasNonEmptyValue(content.current)
    );
  }

  if (row.type === "startup_customer_interview") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasHypothesisAssociation(artifact) &&
      hasNonEmptyString(content.persona) &&
      hasNonEmptyString(content.problem) &&
      hasNonEmptyString(content.signalStrength) &&
      (hasNonEmptyString(content.quote) || hasNonEmptyString(content.summary))
    );
  }

  if (row.type === "startup_competitor") {
    const content = parsedArtifactContent(artifact);

    return (
      isRecord(content) &&
      hasSourceRefs(artifact) &&
      hasNonEmptyString(content.competitor) &&
      hasNonEmptyString(content.finding) &&
      hasNonEmptyString(content.signalStrength)
    );
  }

  return false;
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
