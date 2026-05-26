import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type {
  RecordWorkspaceCheckpointCreatedEventOptions,
  RecordWorkspaceCheckpointRestoreEventOptions
} from "./checkpoints-types.js";

export function recordWorkspaceCheckpointRestoreEvent(
  options: RecordWorkspaceCheckpointRestoreEventOptions
): RunsteadEvent {
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "checkpoint.restored",
    aggregateType: "checkpoint",
    aggregateId: options.result.checkpoint.id,
    payload: {
      workspace: options.result.checkpoint.workspace,
      checkpointId: options.result.checkpoint.id,
      currentHead: options.result.currentHead ?? "",
      restoredTrackedPatch: options.result.restoredTrackedPatch,
      restoredUntrackedFiles: options.result.restoredUntrackedFiles,
      removedUntrackedFiles: options.result.removedUntrackedFiles,
      ...(options.actor === undefined ? {} : { actor: options.actor })
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(options.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
}

export function recordWorkspaceCheckpointCreatedEvent(
  options: RecordWorkspaceCheckpointCreatedEventOptions
): RunsteadEvent {
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "checkpoint.created",
    aggregateType: "checkpoint",
    aggregateId: options.checkpoint.id,
    payload: {
      workspace: options.checkpoint.workspace,
      checkpointId: options.checkpoint.id,
      head: options.checkpoint.head ?? "",
      untrackedFiles: options.checkpoint.untrackedFiles,
      ...(options.actor === undefined ? {} : { actor: options.actor })
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(options.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
}
