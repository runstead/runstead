import { startupGateFindings } from "./startup-gate-findings.js";
import { launchBlockers } from "./startup-gate-launch.js";
import { scaleBlockers } from "./startup-gate-scale.js";
import { validationBlockers } from "./startup-gate-validation.js";
import { activeStartupGateWaivers } from "./startup-gate-waivers.js";
import { gateWarnings } from "./startup-gate-warnings.js";
import type {
  StartupGateDiff,
  StartupGateEvaluationContext,
  StartupGateEvaluationInput,
  StartupGateEvaluationResult,
  StartupGatePreviousEvent
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
