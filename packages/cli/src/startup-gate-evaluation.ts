import {
  artifactSources,
  hasNonEmptyString,
  isRecord,
  parsedArtifactContent,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";
import {
  explainGateBlocker,
  inferGateFindingSeverity,
  remediationTaskForBlocker,
  stableGateFindingId,
  startupGateRuleForBlocker
} from "./startup-gate-rules.js";
import { type StartupGateStage } from "./startup-evidence-types.js";
import { hasPassingCommandOutput, launchBlockers } from "./startup-gate-launch.js";
import { scaleBlockers } from "./startup-gate-scale.js";
import {
  hasStructuredMetricEvidence,
  validationBlockers
} from "./startup-gate-validation.js";
import type {
  StartupGateDiff,
  StartupGateEvaluationContext,
  StartupGateEvaluationInput,
  StartupGateEvaluationResult,
  StartupGateEvidenceRow,
  StartupGateFinding,
  StartupGatePreviousEvent,
  StartupGateTaskRow,
  StartupGateWaiver
} from "./startup-gate-types.js";

export function evaluateStartupGate(
  input: StartupGateEvaluationInput
): StartupGateEvaluationResult {
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

function gateBlockers(input: StartupGateEvaluationContext): string[] {
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

function gateWarnings(input: StartupGateEvaluationContext): string[] {
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

function activeStartupGateWaivers(
  input: StartupGateEvaluationContext
): StartupGateWaiver[] {
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

function hasCompletedTask(tasks: StartupGateTaskRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: StartupGateEvidenceRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}
