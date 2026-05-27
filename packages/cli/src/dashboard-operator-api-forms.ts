import type { JsonObject } from "@runstead/core";

import {
  optionalStartupGateStage,
  requiredStringBodyField,
  stringArrayBodyField,
  stringBodyField
} from "./dashboard-operator-api-body.js";
import { requireDashboardOperatorPermission } from "./dashboard-operator-api-permissions.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { runTaskVerifiers } from "./verifier-runner.js";

export async function runDashboardVerifiers(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "run verifiers"
  });

  const taskId = requiredStringBodyField(input.body.taskId, "taskId");
  const mode = stringBodyField(input.body.mode);
  const result = await runTaskVerifiers({
    cwd: input.cwd,
    taskId,
    mode: mode === "finalize_task" ? "finalize_task" : "evidence_only"
  });

  return {
    taskId: result.task.id,
    taskStatus: result.task.status,
    verifierCount: result.commandResults.length,
    evidenceIds: result.commandResults
      .map((item) => item.evidenceId)
      .filter((id): id is string => id !== undefined)
  };
}

export async function recordDashboardManualEvidence(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "evidence.write",
    action: "record manual evidence"
  });

  const type = stringBodyField(input.body.type) ?? "manual_change";
  const summary = requiredStringBodyField(input.body.summary, "summary");
  const gate = optionalStartupGateStage(input.body.gate);
  const result = await addStartupEvidence({
    cwd: input.cwd,
    type,
    summary,
    sourceRefs: stringArrayBodyField(input.body.sourceRefs),
    ...(stringBodyField(input.body.content) === undefined
      ? {}
      : { content: stringBodyField(input.body.content) ?? "" }),
    ...(stringBodyField(input.body.goalId) === undefined
      ? {}
      : { goalId: stringBodyField(input.body.goalId) ?? "" }),
    ...(gate === undefined ? {} : { gate }),
    ...(stringBodyField(input.body.blocker) === undefined
      ? {}
      : { blocker: stringBodyField(input.body.blocker) ?? "" })
  });

  return {
    evidenceId: result.evidence.id,
    evidenceType: result.evidence.type,
    artifactPath: result.artifactPath
  };
}
