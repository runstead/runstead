import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { showTask } from "./tasks.js";
import {
  storeCommandVerifierEvidence,
  type CommandVerifierInput,
  type StoreCommandVerifierEvidenceResult
} from "./verifier-evidence.js";

export interface RunTaskVerifiersOptions {
  cwd?: string;
  taskId: string;
  timeoutMs?: number;
  now?: Date;
}

export interface RunTaskVerifierCommandResult {
  verifier: string;
  exitCode: number | null;
  timedOut: boolean;
  evidenceId: string;
}

export interface RunTaskVerifiersResult {
  task: Task;
  commandResults: RunTaskVerifierCommandResult[];
}

export async function runTaskVerifiers(
  options: RunTaskVerifiersOptions
): Promise<RunTaskVerifiersResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = join(cwd, ".runstead");
  const stateDb = join(root, "state.db");
  const createdAt = (options.now ?? new Date()).toISOString();
  const task = showTask({ cwd, id: options.taskId }).task;
  const runningTask: Task = {
    ...task,
    status: "running",
    attempt: task.attempt + 1,
    updatedAt: createdAt
  };
  const commands = verifierCommandsFromTask(task);
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event: taskEvent(
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

    const evidenceResults: StoreCommandVerifierEvidenceResult[] = [];

    for (const command of commands) {
      evidenceResults.push(
        await storeCommandVerifierEvidence({
          cwd,
          runsteadRoot: root,
          database,
          task: runningTask,
          command,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.now === undefined ? {} : { now: options.now })
        })
      );
    }

    const commandResults = evidenceResults.map((result) => ({
      verifier: result.artifact.verifier,
      exitCode: result.artifact.result.exitCode,
      timedOut: result.artifact.result.timedOut,
      evidenceId: result.evidence.id
    }));
    const passed =
      commandResults.length > 0 &&
      commandResults.every(
        (result) => result.exitCode === 0 && result.timedOut === false
      );
    const finalTask: Task = {
      ...runningTask,
      status: passed ? "completed" : "failed",
      output: verifierOutput(commandResults, passed),
      updatedAt: createdAt
    };

    appendEventAndProject(database, {
      event: taskEvent(
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

    return {
      task: finalTask,
      commandResults
    };
  } finally {
    database.close();
  }
}

function verifierCommandsFromTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return (commands as unknown[]).flatMap((command) => {
    if (isRecord(command)) {
      const name = command.name;
      const commandText = command.command;

      if (typeof name !== "string" || typeof commandText !== "string") {
        return [];
      }

      return [
        {
          name,
          command: commandText
        }
      ];
    }

    return [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function verifierOutput(
  commandResults: RunTaskVerifierCommandResult[],
  passed: boolean
): JsonObject {
  return {
    summary: passed
      ? "All verifier commands passed"
      : commandResults.length === 0
        ? "No verifier commands configured"
        : "One or more verifier commands failed",
    commands: commandResults
  };
}

function taskEvent(
  type: string,
  task: Task,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType: "task",
    aggregateId: task.id,
    payload,
    createdAt
  };
}
