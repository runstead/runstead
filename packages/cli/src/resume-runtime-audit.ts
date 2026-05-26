import type { JsonObject, Task, ToolCall, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { finishToolCall, finishWorkerRun } from "./runtime-audit.js";

export function failInterruptedToolCalls(input: {
  database: RunsteadDatabase;
  task: Task;
  now: Date;
}): ToolCall[] {
  const interruptedToolCalls = (
    input.database
      .prepare(
        `
        SELECT id, worker_run_id, task_id, action_type, status,
               policy_decision_id, input_json, output_json, started_at, ended_at
        FROM tool_calls
        WHERE task_id = ? AND status IN ('requested', 'allowed', 'running')
        ORDER BY started_at ASC, id ASC
      `
      )
      .all(input.task.id) as unknown as ToolCallRow[]
  ).map(rowToToolCall);

  return interruptedToolCalls.map((toolCall) =>
    finishToolCall({
      database: input.database,
      toolCall,
      status: "failed",
      ...(toolCall.policyDecisionId === undefined
        ? {}
        : { policyDecisionId: toolCall.policyDecisionId }),
      output: {
        ...(toolCall.output ?? {}),
        summary: "Tool call interrupted during resume",
        previousTaskStatus: input.task.status
      },
      now: input.now
    })
  );
}

export function failRunningWorkerRuns(input: {
  database: RunsteadDatabase;
  task: Task;
  now: Date;
}): WorkerRun[] {
  const runningWorkerRuns = (
    input.database
      .prepare(
        `
        SELECT id, task_id, worker_type, status, enforcement_level,
               checkpoint_before, started_at, ended_at, output_json
        FROM worker_runs
        WHERE task_id = ? AND status = 'running'
        ORDER BY started_at ASC, id ASC
      `
      )
      .all(input.task.id) as unknown as WorkerRunRow[]
  ).map(rowToWorkerRun);

  return runningWorkerRuns.map((workerRun) =>
    finishWorkerRun({
      database: input.database,
      workerRun,
      status: "failed",
      output: {
        ...(workerRun.output ?? {}),
        summary: "Worker run interrupted during resume",
        previousTaskStatus: input.task.status
      },
      now: input.now
    })
  );
}

interface WorkerRunRow {
  id: string;
  task_id: string;
  worker_type: string;
  status: WorkerRun["status"];
  enforcement_level: string;
  checkpoint_before: string | null;
  started_at: string;
  ended_at: string | null;
  output_json: string | null;
}

interface ToolCallRow {
  id: string;
  worker_run_id: string;
  task_id: string;
  action_type: string;
  status: ToolCall["status"];
  policy_decision_id: string | null;
  input_json: string;
  output_json: string | null;
  started_at: string;
  ended_at: string | null;
}

function rowToWorkerRun(row: WorkerRunRow): WorkerRun {
  return {
    id: row.id,
    taskId: row.task_id,
    workerType: row.worker_type,
    status: row.status,
    enforcementLevel: row.enforcement_level,
    ...(row.checkpoint_before === null
      ? {}
      : { checkpointBefore: row.checkpoint_before }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject })
  };
}

function rowToToolCall(row: ToolCallRow): ToolCall {
  return {
    id: row.id,
    workerRunId: row.worker_run_id,
    taskId: row.task_id,
    actionType: row.action_type,
    status: row.status,
    ...(row.policy_decision_id === null
      ? {}
      : { policyDecisionId: row.policy_decision_id }),
    input: JSON.parse(row.input_json) as JsonObject,
    ...(row.output_json === null
      ? {}
      : { output: JSON.parse(row.output_json) as JsonObject }),
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at })
  };
}
