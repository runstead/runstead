import {
  explainGateBlocker,
  inferGateFindingSeverity,
  remediationTaskForBlocker,
  stableGateFindingId,
  startupGateRuleForBlocker
} from "./startup-gate-rules.js";
import type { StartupGateStage } from "./startup-evidence-types.js";
import type {
  StartupGateFinding,
  StartupGateWaiver
} from "./startup-gate-types.js";

export function startupGateFindings(
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
