import { join } from "node:path";

import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  createWorkspaceCheckpoint,
  recordWorkspaceCheckpointCreatedEvent,
  type WorkspaceCheckpoint
} from "./checkpoints.js";
import { runGovernedToolAction } from "./governed-action.js";
import {
  localAgentCheckpointCreateAction,
  localAgentCheckpointOutput
} from "./local-agent-actions.js";
import { localAgentTaskNeedsCheckpoint } from "./local-agent-task-input.js";
import type { PolicyProfile } from "./policy.js";

export async function createLocalAgentCheckpointIfNeeded(options: {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  now?: Date;
}): Promise<WorkspaceCheckpoint | undefined> {
  if (!localAgentTaskNeedsCheckpoint(options.task)) {
    return undefined;
  }

  const checkpointDir = join(options.root, "checkpoints");
  const governed = await runGovernedToolAction({
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    action: localAgentCheckpointCreateAction({
      task: options.task,
      cwd: options.cwd,
      checkpointDir
    }),
    requestedBy: "runstead:local-agent",
    ...(options.now === undefined ? {} : { now: options.now }),
    run: async () => {
      const value = await createWorkspaceCheckpoint({
        workspace: options.cwd,
        checkpointDir,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      recordWorkspaceCheckpointCreatedEvent({
        stateDb: options.stateDb,
        checkpoint: value,
        actor: "runstead:local-agent",
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value,
        output: localAgentCheckpointOutput(value)
      };
    }
  });

  return governed.value;
}
