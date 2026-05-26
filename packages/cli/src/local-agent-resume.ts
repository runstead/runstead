import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { showApproval } from "./approvals.js";
import {
  readApprovedCodexDirectPendingPatch,
  type CodexDirectPendingPatchResume
} from "./codex-direct-worker.js";
import type { ResolveLocalAgentResumeTargetResult } from "./local-agent-types.js";

export function resolveLocalAgentResumeTarget(input: {
  cwd?: string;
  targetId: string;
}): ResolveLocalAgentResumeTargetResult {
  if (!input.targetId.startsWith("appr_")) {
    return {
      taskId: input.targetId
    };
  }

  const shown = showApproval({
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    id: input.targetId
  });

  if (shown.task === undefined) {
    throw new Error(
      `Approval ${input.targetId} is not associated with a local agent task`
    );
  }

  if (shown.approval.status === "pending") {
    throw new Error(
      `Approval ${input.targetId} is pending; run: runstead approval approve-and-resume ${input.targetId}`
    );
  }

  if (shown.approval.status !== "approved") {
    throw new Error(
      `Approval ${input.targetId} is ${shown.approval.status}; only approved approvals can be resumed`
    );
  }

  return {
    taskId: shown.task.id,
    approvalId: input.targetId,
    note: `Resolved approval ${input.targetId} to local agent task ${shown.task.id}.`
  };
}

export function readLocalAgentApprovedPendingPatch(
  stateDb: string,
  task: Task
): CodexDirectPendingPatchResume | undefined {
  const approval = task.output?.approval;

  if (
    !isRecord(approval) ||
    approval.status !== "approved" ||
    typeof approval.id !== "string"
  ) {
    return undefined;
  }

  const database = openRunsteadDatabase(stateDb);

  try {
    return readApprovedCodexDirectPendingPatch(database, approval.id);
  } finally {
    database.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
