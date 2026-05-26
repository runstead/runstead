import type { Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  incrementCiRepairCounter,
  stageAtLeast,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import {
  writeCiRepairContextPatch,
  writeCiRepairStage
} from "./ci-repair-orchestrator-stage-persistence.js";

export function claimCiRepairOrchestratorTask(input: {
  database: RunsteadDatabase;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  restored: boolean;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}): { task: Task; context: CiRepairOrchestratorStageContext } {
  let task = input.task;
  let context = input.context;

  if (input.restored) {
    ({ task, context } = writeCiRepairContextPatch({
      database: input.database,
      task,
      context,
      patch: {
        counters: incrementCiRepairCounter(context, "orchestratorAttempt")
      },
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  if (!stageAtLeast(context.stage, "intake_completed")) {
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "intake_completed",
      ...(input.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.onStagePersisted }),
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  if (!stageAtLeast(context.stage, "claimed")) {
    ({ task, context } = writeCiRepairStage({
      database: input.database,
      task,
      context,
      stage: "claimed",
      ...(input.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.onStagePersisted }),
      ...(input.now === undefined ? {} : { now: input.now })
    }));
  }

  return { task, context };
}
