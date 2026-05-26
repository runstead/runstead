import { addStartupEvidence } from "./startup-evidence-record.js";
import type {
  AddStartupEvidenceResult,
  AddStartupHypothesisOptions,
  RecordStartupGateDecisionOptions,
  RecordStartupManualChangeOptions
} from "./startup-evidence-record-types.js";

const STARTUP_DOMAIN = "ai-native-startup";

export async function addStartupHypothesis(
  options: AddStartupHypothesisOptions
): Promise<AddStartupEvidenceResult> {
  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: `${options.kind}_hypothesis`,
    summary: `${options.kind} hypothesis: ${options.statement}`,
    sourceRefs: options.sourceRefs ?? [],
    content: JSON.stringify(
      {
        kind: options.kind,
        statement: options.statement,
        status: options.status ?? "open"
      },
      null,
      2
    ),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function recordStartupManualChange(
  options: RecordStartupManualChangeOptions
): Promise<AddStartupEvidenceResult> {
  const content = {
    changeSource: "operator",
    actor: options.operator,
    reason: options.reason,
    diffSummary: options.diffSummary,
    filesTouched: options.filesTouched ?? [],
    commandsRerun: options.commandsRerun ?? [],
    evidenceRefs: options.evidenceRefs ?? []
  };

  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "manual_change",
    summary: `Operator ${options.operator}: ${options.diffSummary}`,
    sourceRefs: options.sourceRefs ?? [],
    sources: [
      {
        kind: "manual",
        uri: `operator:${options.operator}`,
        ...(options.now === undefined ? {} : { capturedAt: options.now.toISOString() }),
        trustLevel: "medium",
        provenance: {
          reason: options.reason
        }
      }
    ],
    content: JSON.stringify(content, null, 2),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function recordStartupGateDecision(
  options: RecordStartupGateDecisionOptions
): Promise<AddStartupEvidenceResult> {
  const isWaiver = options.decision === "waive_blocker";

  if (isWaiver) {
    if (options.blocker === undefined || options.blocker.trim().length === 0) {
      throw new Error("gate waiver requires a blocker");
    }

    if (options.owner === undefined || options.owner.trim().length === 0) {
      throw new Error("gate waiver requires an owner");
    }

    if (
      options.expiresAt === undefined ||
      Number.isNaN(Date.parse(options.expiresAt))
    ) {
      throw new Error("gate waiver requires a valid expiresAt timestamp");
    }
  }

  return addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "decision",
    summary: isWaiver
      ? `Waived ${options.stage} blocker: ${options.blocker}`
      : `Startup ${options.stage} decision: ${options.decision}`,
    gate: options.stage,
    ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
    content: JSON.stringify(
      {
        kind: isWaiver ? "gate_waiver" : "release_decision",
        domain: options.domain ?? STARTUP_DOMAIN,
        gate: options.stage,
        decision: options.decision,
        reason: options.reason,
        ...(options.comment === undefined ? {} : { comment: options.comment }),
        ...(options.owner === undefined ? {} : { owner: options.owner }),
        ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
        ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt })
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
