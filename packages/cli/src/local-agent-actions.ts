import { createHash } from "node:crypto";

import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import { CODEX_DIRECT_WORKER_KIND } from "./codex-direct-worker.js";
import type { LocalAgentWorkerKind } from "./local-agent-task-input.js";
import type { ActionEnvelope } from "./policy.js";

export function localAgentWorkerStartAction(input: {
  task: Task;
  cwd: string;
  worker: LocalAgentWorkerKind;
}): ActionEnvelope {
  const nativeWorker = input.worker === CODEX_DIRECT_WORKER_KIND;

  return {
    actionId: stableActionId(
      nativeWorker ? "worker_native_start" : "worker_external_start",
      [input.task.id, input.worker]
    ),
    actionType: nativeWorker ? "worker.native.start" : "worker.external.start",
    resource: {
      type: "process",
      id: input.worker
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function localAgentCheckpointCreateAction(input: {
  task: Task;
  cwd: string;
  checkpointDir: string;
}): ActionEnvelope {
  return {
    actionId: stableActionId("checkpoint_create", [
      input.task.id,
      input.cwd,
      input.checkpointDir
    ]),
    actionType: "checkpoint.create",
    resource: {
      type: "repository",
      id: input.cwd
    },
    context: {
      cwd: input.cwd
    }
  };
}

export function localAgentCheckpointOutput(
  checkpoint: WorkspaceCheckpoint
): JsonObject {
  return {
    checkpointId: checkpoint.id,
    head: checkpoint.head ?? "",
    untrackedFiles: checkpoint.untrackedFiles
  };
}

export function localAgentEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  createdAt: string,
  payload: RunsteadEvent["payload"]
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType,
    aggregateId,
    payload,
    createdAt
  };
}

function stableActionId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 12);

  return `act_${prefix.replaceAll(".", "_")}_${hash}`;
}
