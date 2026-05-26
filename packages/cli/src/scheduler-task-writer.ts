import type { Goal, RunsteadEvent, Task } from "@runstead/core";
import type { TaskType } from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { repositoryPathForGoal } from "./scheduler-recurrence.js";
import type { ScheduledTaskResult } from "./scheduler.js";
import { buildDomainTask, buildRunLocalVerifiersTask } from "./tasks.js";

export async function scheduleRunLocalVerifiersTask(input: {
  cwd: string;
  stateDb: string;
  goal: Goal;
  now: Date;
  dueAt: string;
  intervalMs: number;
  lastTask?: Task;
}): Promise<ScheduledTaskResult> {
  const scheduledAt = input.now.toISOString();
  const repositoryPath = repositoryPathForGoal(input.goal, input.cwd);
  const generated = await buildRunLocalVerifiersTask({
    cwd: repositoryPath,
    goal: input.goal,
    now: input.now
  });
  const task: Task = {
    ...generated.task,
    input: {
      ...generated.task.input,
      schedule: scheduleTaskInput({
        type: generated.task.type,
        dueAt: input.dueAt,
        intervalMs: input.intervalMs,
        scheduledAt,
        lastTask: input.lastTask
      })
    }
  };
  const event: RunsteadEvent = {
    ...generated.event,
    type: "task.scheduled",
    payload: {
      goalId: task.goalId,
      type: task.type,
      source: "background_scheduler",
      dueAt: input.dueAt,
      intervalMs: input.intervalMs,
      ...lastTaskPayload(input.lastTask)
    },
    createdAt: scheduledAt
  };

  appendScheduledTask(input.stateDb, event, task);

  return {
    goalId: input.goal.id,
    type: task.type,
    task,
    event,
    dueAt: input.dueAt,
    intervalMs: input.intervalMs
  };
}

export function scheduleDomainTask(input: {
  cwd: string;
  stateDb: string;
  goal: Goal;
  taskType: TaskType;
  now: Date;
  dueAt: string;
  intervalMs: number;
  lastTask?: Task;
}): ScheduledTaskResult {
  const scheduledAt = input.now.toISOString();
  const generated = buildDomainTask({
    cwd: repositoryPathForGoal(input.goal, input.cwd),
    goal: input.goal,
    taskType: input.taskType,
    now: input.now
  });
  const task: Task = {
    ...generated.task,
    input: {
      ...generated.task.input,
      schedule: scheduleTaskInput({
        type: generated.task.type,
        dueAt: input.dueAt,
        intervalMs: input.intervalMs,
        scheduledAt,
        lastTask: input.lastTask
      })
    }
  };
  const event: RunsteadEvent = {
    ...generated.event,
    type: "task.scheduled",
    payload: {
      goalId: task.goalId,
      type: task.type,
      source: "background_scheduler",
      dueAt: input.dueAt,
      intervalMs: input.intervalMs,
      workerRouting: input.taskType.workerRouting,
      ...lastTaskPayload(input.lastTask)
    },
    createdAt: scheduledAt
  };

  appendScheduledTask(input.stateDb, event, task);

  return {
    goalId: input.goal.id,
    type: task.type,
    task,
    event,
    dueAt: input.dueAt,
    intervalMs: input.intervalMs
  };
}

function scheduleTaskInput(input: {
  type: string;
  dueAt: string;
  intervalMs: number;
  scheduledAt: string;
  lastTask: Task | undefined;
}): Record<string, unknown> {
  return {
    source: "background_scheduler",
    recurrenceType: input.type,
    dueAt: input.dueAt,
    intervalMs: input.intervalMs,
    scheduledAt: input.scheduledAt,
    ...lastTaskPayload(input.lastTask)
  };
}

function lastTaskPayload(lastTask: Task | undefined): {
  lastTaskId?: string;
  lastTaskStatus?: Task["status"];
} {
  return lastTask === undefined
    ? {}
    : {
        lastTaskId: lastTask.id,
        lastTaskStatus: lastTask.status
      };
}

function appendScheduledTask(stateDb: string, event: RunsteadEvent, task: Task): void {
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}
