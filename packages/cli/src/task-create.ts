import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { buildRunLocalVerifiersTask } from "./task-builders.js";
import { resolveTaskStateDb } from "./task-state.js";
import type {
  CreateRunLocalVerifiersTaskOptions,
  CreateTaskResult
} from "./tasks-types.js";

export async function createRunLocalVerifiersTask(
  options: CreateRunLocalVerifiersTaskOptions
): Promise<CreateTaskResult> {
  const stateDb = options.stateDb ?? resolveTaskStateDb(options.cwd);
  const generated = await buildRunLocalVerifiersTask(options);
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event: generated.event,
      projection: {
        type: "task",
        value: generated.task
      }
    });
  } finally {
    database.close();
  }

  return {
    ...generated,
    stateDb
  };
}
