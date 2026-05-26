import { resolve } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { commandVerifierResultsPassed } from "@runstead/verifiers";

import { withRunsteadManagerLock } from "./manager-lock.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { runVerifierCommand } from "./verifier-runner-command.js";
import { loadVerifierPolicy } from "./verifier-runner-policy.js";
import {
  configuredVerifierCommandsFromTask,
  loadVerifierTask,
  verifierCommandsFromTask
} from "./verifier-runner-task-input.js";
import {
  finalizeVerifierTask,
  verifierTaskEvent
} from "./verifier-runner-task-state.js";
import { verifierOutput } from "./verifier-runner-output.js";
import type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner-types.js";

export type {
  RunTaskVerifierCommandResult,
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner-types.js";

export async function runTaskVerifiers(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, () =>
    runTaskVerifiersUnlocked({
      ...options,
      cwd
    })
  );
}

export async function runTaskVerifiersUnlocked(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const root = resolvedState.root;
  const stateDb = resolvedState.stateDb;
  const createdAt = (options.now ?? new Date()).toISOString();
  const projectTaskState = options.mode !== "evidence_only";
  const task = loadVerifierTask({
    cwd,
    taskId: options.taskId,
    ...(options.claim === undefined ? {} : { claim: options.claim }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const commands = await verifierCommandsFromTask({
    cwd,
    task,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const taskWithCommands =
    commands.length > 0 && configuredVerifierCommandsFromTask(task).length === 0
      ? {
          ...task,
          input: {
            ...task.input,
            commands
          }
        }
      : task;
  const policy = await loadVerifierPolicy({ root, cwd, task: taskWithCommands });
  const runningTask: Task = {
    ...taskWithCommands,
    status: "running",
    updatedAt: createdAt
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    if (projectTaskState) {
      appendEventAndProject(database, {
        event: verifierTaskEvent(
          "task.started",
          runningTask,
          { attempt: runningTask.attempt },
          createdAt
        ),
        projection: {
          type: "task",
          value: runningTask
        }
      });
    }
    let currentTask = runningTask;
    let executionAttemptStarted = false;
    const startExecutionAttempt = (): Task => {
      if (executionAttemptStarted) {
        return currentTask;
      }

      executionAttemptStarted = true;
      currentTask = {
        ...currentTask,
        attempt: currentTask.attempt + 1,
        updatedAt: createdAt
      };
      if (projectTaskState) {
        appendEventAndProject(database, {
          event: verifierTaskEvent(
            "task.execution_started",
            currentTask,
            {
              previousAttempt: task.attempt,
              attempt: currentTask.attempt
            },
            createdAt
          ),
          projection: {
            type: "task",
            value: currentTask
          }
        });
      }

      return currentTask;
    };
    const workerRun = startWorkerRun({
      database,
      task: runningTask,
      workerType: "shell_verifier",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    const commandResults: RunTaskVerifierCommandResult[] = [];

    for (const [index, command] of commands.entries()) {
      const result = await runVerifierCommand({
        cwd,
        root,
        stateDb,
        database,
        policy,
        runningTask,
        currentTask,
        workerRun,
        command,
        index,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.killGraceMs === undefined
          ? {}
          : { killGraceMs: options.killGraceMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
        startExecutionAttempt
      });
      currentTask = result.currentTask;
      commandResults.push(result.commandResult);

      if (result.status !== "completed") {
        const output = verifierOutput(commandResults, false);

        finishWorkerRun({
          database,
          workerRun,
          status: result.status,
          output,
          ...(options.now === undefined ? {} : { now: options.now })
        });

        const finalTask = finalizeVerifierTask({
          runningTask: currentTask,
          status: result.status,
          output,
          updatedAt: createdAt,
          database,
          projectTaskState
        });

        return {
          task: finalTask,
          commandResults
        };
      }
    }

    const passed = commandVerifierResultsPassed(commandResults);
    const output = verifierOutput(commandResults, passed);
    const finalTask: Task = {
      ...currentTask,
      status: passed ? "completed" : "failed",
      output,
      updatedAt: createdAt
    };

    if (projectTaskState) {
      appendEventAndProject(database, {
        event: verifierTaskEvent(
          passed ? "task.completed" : "task.failed",
          finalTask,
          finalTask.output ?? {},
          createdAt
        ),
        projection: {
          type: "task",
          value: finalTask
        }
      });
    }
    finishWorkerRun({
      database,
      workerRun,
      status: passed ? "completed" : "failed",
      output,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      task: finalTask,
      commandResults
    };
  } finally {
    database.close();
  }
}
