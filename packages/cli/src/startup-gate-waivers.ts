import {
  hasNonEmptyString,
  isRecord,
  parsedArtifactContent
} from "./startup-gate-artifacts.js";
import type {
  StartupGateEvaluationContext,
  StartupGateWaiver
} from "./startup-gate-types.js";

export function activeStartupGateWaivers(
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
