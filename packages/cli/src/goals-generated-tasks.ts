import type { Goal, RunsteadEvent, Task } from "@runstead/core";
import type { DomainPackBundle } from "@runstead/domain-packs";

import {
  buildCommandVerifierDomainTask,
  buildDomainTask,
  buildRunLocalVerifiersTask
} from "./tasks.js";

export async function buildGeneratedGoalTasks(input: {
  cwd: string;
  goal: Goal;
  bundle: DomainPackBundle;
  taskTypeIds: string[];
  now: Date;
}): Promise<{ task: Task; event: RunsteadEvent }[]> {
  const taskTypesById = new Map(
    input.bundle.taskTypes.map((taskType) => [taskType.id, taskType])
  );
  const generated: { task: Task; event: RunsteadEvent }[] = [];

  for (const taskTypeId of input.taskTypeIds) {
    if (taskTypeId === "run_local_verifiers") {
      generated.push(
        await buildRunLocalVerifiersTask({
          cwd: input.cwd,
          goal: input.goal,
          now: input.now
        })
      );
      continue;
    }

    const taskType = taskTypesById.get(taskTypeId);

    if (taskType === undefined) {
      throw new Error(
        `Goal template references unknown task type ${taskTypeId} in domain pack ${input.bundle.domain.id}`
      );
    }

    if (taskTypeId === "run_mvp_verifiers") {
      generated.push(
        await buildCommandVerifierDomainTask({
          cwd: input.cwd,
          goal: input.goal,
          taskType,
          now: input.now
        })
      );
      continue;
    }

    generated.push(
      buildDomainTask({
        cwd: input.cwd,
        goal: input.goal,
        taskType,
        now: input.now
      })
    );
  }

  return generated;
}
