import type { Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import type { CiRepairOrchestratorStage } from "./ci-repair-orchestrator-stage.js";
import { writeTaskOutput } from "./ci-repair-orchestrator-task-state.js";

export function writeCiRepairStage(input: {
  database: RunsteadDatabase;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  stage: CiRepairOrchestratorStage;
  patch?: Partial<CiRepairOrchestratorStageContext>;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}): { task: Task; context: CiRepairOrchestratorStageContext } {
  const context: CiRepairOrchestratorStageContext = {
    ...input.context,
    ...(input.patch ?? {}),
    stage: input.stage
  };
  const task = writeTaskOutput({
    database: input.database,
    task: input.task,
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: context
    },
    eventType: "task.updated",
    ...(input.now === undefined ? {} : { now: input.now })
  });
  input.onStagePersisted?.(input.stage, task);

  return {
    task,
    context
  };
}

export function writeCiRepairContextPatch(input: {
  database: RunsteadDatabase;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  patch: Partial<CiRepairOrchestratorStageContext>;
  now?: Date;
}): { task: Task; context: CiRepairOrchestratorStageContext } {
  const context: CiRepairOrchestratorStageContext = {
    ...input.context,
    ...input.patch
  };
  const task = writeTaskOutput({
    database: input.database,
    task: input.task,
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: context
    },
    eventType: "task.updated",
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    task,
    context
  };
}
