import { resolve } from "node:path";

import {
  createRunsteadId,
  TaskSchema,
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import type { TaskType } from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  inspectBuildCommand,
  inspectLintCommand,
  inspectTestCommand,
  inspectTypecheckCommand,
  type PackageScriptCommandInspection
} from "./repo-inspection.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

const EXECUTION_LEASE_MS = 30 * 60 * 1000;

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

export interface ClaimTaskResult {
  task: Task;
  event: RunsteadEvent;
  stateDb: string;
}

export interface BuildRunLocalVerifiersTaskOptions {
  cwd?: string;
  goal: Goal;
  now?: Date;
}

export interface BuildDomainTaskOptions {
  cwd?: string;
  goal: Goal;
  taskType: TaskType;
  now?: Date;
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

export async function buildRunLocalVerifiersTask(
  options: BuildRunLocalVerifiersTaskOptions
): Promise<{ task: Task; event: RunsteadEvent }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const createdAt = (options.now ?? new Date()).toISOString();
  const [testCommand, lintCommand] = await Promise.all([
    inspectTestCommand(cwd),
    inspectLintCommand(cwd)
  ]);
  const commands = [
    verifierCommand("test", testCommand),
    verifierCommand("lint", lintCommand)
  ].filter((command) => command !== undefined);
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: options.goal.id,
    domain: options.goal.domain,
    type: "run_local_verifiers",
    status: "queued",
    priority: "medium",
    attempt: 0,
    maxAttempts: 1,
    input: {
      repositoryPath: goalRepositoryPath(options.goal, cwd),
      commands
    },
    verifiers: commands.map((command) => `command:${command.name}`),
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      commands
    },
    createdAt
  };

  return {
    task,
    event
  };
}

export async function buildCommandVerifierDomainTask(
  options: BuildDomainTaskOptions
): Promise<{ task: Task; event: RunsteadEvent }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const generated = buildDomainTask(options);
  const commands = await inspectCommandVerifierScripts(cwd);
  const task: Task = {
    ...generated.task,
    input: {
      ...generated.task.input,
      commands
    }
  };
  const event: RunsteadEvent = {
    ...generated.event,
    payload: {
      ...generated.event.payload,
      commands
    }
  };

  return {
    task,
    event
  };
}

export function buildDomainTask(options: BuildDomainTaskOptions): {
  task: Task;
  event: RunsteadEvent;
} {
  const cwd = resolve(options.cwd ?? process.cwd());
  const createdAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    id: createRunsteadId("task"),
    goalId: options.goal.id,
    domain: options.goal.domain,
    type: options.taskType.id,
    status: "queued",
    priority: options.taskType.defaultPriority,
    attempt: 0,
    maxAttempts: options.taskType.maxAttempts,
    input: {
      repositoryPath: goalRepositoryPath(options.goal, cwd),
      taskType: options.taskType.id,
      description: options.taskType.description,
      workerRouting: options.taskType.workerRouting
    },
    verifiers: [...options.taskType.verifiers.required],
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      workerRouting: options.taskType.workerRouting,
      verifiers: task.verifiers
    },
    createdAt
  };

  return {
    task,
    event
  };
}

export async function createRunLocalVerifiersTask(
  options: CreateRunLocalVerifiersTaskOptions
): Promise<CreateTaskResult> {
  const stateDb = options.stateDb ?? resolveStateDb(options.cwd);
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

export function listTasks(options: ListTasksOptions = {}): ListTasksResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows =
      options.goalId === undefined
        ? (database
            .prepare(
              `
              SELECT id, goal_id, domain, type, status, priority, attempt,
                     max_attempts, input_json, output_json, verifiers_json,
                     created_at, updated_at
              FROM tasks
              ORDER BY created_at DESC, id ASC
            `
            )
            .all() as unknown as TaskRow[])
        : (database
            .prepare(
              `
              SELECT id, goal_id, domain, type, status, priority, attempt,
                     max_attempts, input_json, output_json, verifiers_json,
                     created_at, updated_at
              FROM tasks
              WHERE goal_id = ?
              ORDER BY created_at DESC, id ASC
            `
            )
            .all(options.goalId) as unknown as TaskRow[]);

    return {
      tasks: rows.map(rowToTask),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showTask(options: ShowTaskOptions): ShowTaskResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT id, goal_id, domain, type, status, priority, attempt,
               max_attempts, input_json, output_json, verifiers_json,
               created_at, updated_at
        FROM tasks
        WHERE id = ?
      `
      )
      .get(options.id) as TaskRow | undefined;

    if (row === undefined) {
      throw new Error(`Task not found: ${options.id}`);
    }

    return {
      task: rowToTask(row),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function claimTask(options: ClaimTaskOptions): ClaimTaskResult {
  const stateDb = resolveStateDb(options.cwd);
  const claimedAt = (options.now ?? new Date()).toISOString();
  const database = openRunsteadDatabase(stateDb);
  let inTransaction = false;

  try {
    database.exec("BEGIN IMMEDIATE");
    inTransaction = true;

    const row = database
      .prepare(
        `
        SELECT id, goal_id, domain, type, status, priority, attempt,
               max_attempts, input_json, output_json, verifiers_json,
               created_at, updated_at
        FROM tasks
        WHERE id = ?
      `
      )
      .get(options.id) as TaskRow | undefined;

    if (row === undefined) {
      throw new Error(`Task not found: ${options.id}`);
    }

    const current = rowToTask(row);

    if (current.status !== "queued") {
      throw new Error(`Task ${options.id} is ${current.status}, expected queued`);
    }

    const task: Task = {
      ...current,
      status: "claimed",
      updatedAt: claimedAt
    };
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "task.claimed",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        previousStatus: current.status
      },
      createdAt: claimedAt
    };
    const update = database
      .prepare(
        `
        UPDATE tasks
        SET status = ?, owner_id = ?, heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `
      )
      .run(
        task.status,
        executionLeaseOwnerId(),
        claimedAt,
        executionLeaseExpiresAt(claimedAt),
        task.updatedAt,
        task.id,
        current.status
      ) as { changes: number };

    if (update.changes !== 1) {
      throw new Error(`Task ${options.id} could not be claimed atomically`);
    }

    insertEvent(database, event);
    database.exec("COMMIT");
    inTransaction = false;

    return {
      task,
      event,
      stateDb
    };
  } catch (error) {
    if (inTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  } finally {
    database.close();
  }
}

export function blockTask(options: BlockTaskOptions): UpdateTaskResult {
  const stateDb = resolveStateDb(options.cwd);
  const blockedAt = (options.now ?? new Date()).toISOString();
  const task: Task = {
    ...options.task,
    status: "blocked",
    output: {
      ...(options.task.output ?? {}),
      ...(options.output ?? {}),
      reason: options.reason
    },
    updatedAt: blockedAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.blocked",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      previousStatus: options.task.status,
      ...(options.output ?? {}),
      reason: options.reason
    },
    createdAt: blockedAt
  };
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

  return {
    task,
    event,
    stateDb
  };
}

function executionLeaseOwnerId(): string {
  return `pid:${process.pid}`;
}

function executionLeaseExpiresAt(heartbeatAt: string): string {
  const parsed = Date.parse(heartbeatAt);
  const heartbeatMs = Number.isNaN(parsed) ? Date.now() : parsed;

  return new Date(heartbeatMs + EXECUTION_LEASE_MS).toISOString();
}

function resolveStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}

interface LocalVerifierCommand {
  name: "test" | "lint" | "typecheck" | "build";
  command: string;
  rawScript: string;
}

async function inspectCommandVerifierScripts(
  cwd: string
): Promise<LocalVerifierCommand[]> {
  const [testCommand, lintCommand, typecheckCommand, buildCommand] = await Promise.all([
    inspectTestCommand(cwd),
    inspectLintCommand(cwd),
    inspectTypecheckCommand(cwd),
    inspectBuildCommand(cwd)
  ]);

  return [
    verifierCommand("test", testCommand),
    verifierCommand("lint", lintCommand),
    verifierCommand("typecheck", typecheckCommand),
    verifierCommand("build", buildCommand)
  ].filter((command) => command !== undefined);
}

function verifierCommand(
  name: LocalVerifierCommand["name"],
  inspection: PackageScriptCommandInspection
): LocalVerifierCommand | undefined {
  if (!inspection.detected || inspection.command === undefined) {
    return undefined;
  }

  return {
    name,
    command: inspection.command,
    rawScript: inspection.rawScript ?? ""
  };
}

function goalRepositoryPath(goal: Goal, cwd: string): string {
  const repositoryPath = goal.scope.repositoryPath;

  return typeof repositoryPath === "string" ? repositoryPath : cwd;
}

interface TaskRow {
  id: string;
  goal_id: string;
  domain: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  input_json: string;
  output_json: string | null;
  verifiers_json: string;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    goalId: row.goal_id,
    domain: row.domain,
    type: row.type,
    status: row.status,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    input: JSON.parse(row.input_json) as JsonObject,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject }),
    verifiers: JSON.parse(row.verifiers_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function insertEvent(
  database: ReturnType<typeof openRunsteadDatabase>,
  event: RunsteadEvent
): void {
  database
    .prepare(
      `
      INSERT INTO events (
        event_id,
        type,
        aggregate_type,
        aggregate_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      event.eventId,
      event.type,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.createdAt
    );
}
