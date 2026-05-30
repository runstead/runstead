import type { JsonObject, RunsteadEvent, Task } from "@runstead/core";

import type { BuildRunLocalVerifiersTaskOptions } from "./task-builders.js";

export interface ListTasksOptions {
  cwd?: string;
  goalId?: string;
}

export interface ListTasksResult {
  tasks: Task[];
  stateDb: string;
}

export interface ShowTaskOptions {
  cwd?: string;
  id: string;
}

export interface ShowTaskResult {
  task: Task;
  stateDb: string;
}

export interface ClaimTaskOptions {
  cwd?: string;
  id: string;
  now?: Date;
}

export interface BlockTaskOptions {
  cwd?: string;
  task: Task;
  reason: string;
  output?: JsonObject;
  now?: Date;
}

export interface CompleteTaskOptions {
  cwd?: string;
  task: Task;
  output?: JsonObject;
  now?: Date;
}

export interface ClaimTaskResult {
  task: Task;
  event: RunsteadEvent;
  stateDb: string;
}

export interface CreateRunLocalVerifiersTaskOptions extends BuildRunLocalVerifiersTaskOptions {
  stateDb?: string;
}

export interface CreateTaskResult {
  task: Task;
  event: RunsteadEvent;
  stateDb: string;
}

export interface UpdateTaskResult {
  task: Task;
  event: RunsteadEvent;
  stateDb: string;
}
