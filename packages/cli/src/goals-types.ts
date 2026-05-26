import type { Goal, RunsteadEvent, Task } from "@runstead/core";

export interface CreateGoalOptions {
  cwd?: string;
  domain: string;
  template?: string;
  title?: string;
  repository?: string;
  now?: Date;
}

export interface CreateGoalResult {
  goal: Goal;
  event: RunsteadEvent;
  generatedTasks: Task[];
  generatedEvents: RunsteadEvent[];
  stateDb: string;
}

export interface ListGoalsOptions {
  cwd?: string;
}

export interface ListGoalsResult {
  goals: Goal[];
  stateDb: string;
}

export interface ShowGoalOptions {
  cwd?: string;
  id: string;
}

export interface ShowGoalResult {
  goal: Goal;
  stateDb: string;
}
