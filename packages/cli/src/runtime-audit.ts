import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task,
  type ToolCall,
  type ToolCallStatus,
  type WorkerRun,
  type WorkerRunStatus
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import type { ActionEnvelope } from "./policy.js";

export interface StartWorkerRunOptions {
  database: RunsteadDatabase;
  task: Task;
  workerType: string;
  enforcementLevel: string;
  checkpointBefore?: string;
  now?: Date;
}

export interface FinishWorkerRunOptions {
  database: RunsteadDatabase;
  workerRun: WorkerRun;
  status: Exclude<WorkerRunStatus, "running">;
  output?: JsonObject;
  now?: Date;
}

export interface StartToolCallOptions {
  database: RunsteadDatabase;
  workerRun: WorkerRun;
  task: Task;
  action: ActionEnvelope;
  now?: Date;
}

export interface FinishToolCallOptions {
  database: RunsteadDatabase;
  toolCall: ToolCall;
  status: Exclude<ToolCallStatus, "requested" | "running">;
  policyDecisionId?: string;
  output?: JsonObject;
  now?: Date;
}

export function startWorkerRun(options: StartWorkerRunOptions): WorkerRun {
  const startedAt = (options.now ?? new Date()).toISOString();
  const workerRun: WorkerRun = {
    id: createRunsteadId("wrun"),
    taskId: options.task.id,
    workerType: options.workerType,
    status: "running",
    enforcementLevel: options.enforcementLevel,
    ...(options.checkpointBefore === undefined
      ? {}
      : { checkpointBefore: options.checkpointBefore }),
    startedAt
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      "worker_run.started",
      "worker_run",
      workerRun.id,
      {
        workerRunId: workerRun.id,
        taskId: workerRun.taskId,
        workerType: workerRun.workerType,
        enforcementLevel: workerRun.enforcementLevel
      },
      startedAt
    ),
    projection: {
      type: "workerRun",
      value: workerRun
    }
  });

  return workerRun;
}

export function finishWorkerRun(options: FinishWorkerRunOptions): WorkerRun {
  const endedAt = (options.now ?? new Date()).toISOString();
  const workerRun: WorkerRun = {
    ...options.workerRun,
    status: options.status,
    endedAt,
    ...(options.output === undefined ? {} : { output: options.output })
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      `worker_run.${options.status}`,
      "worker_run",
      workerRun.id,
      {
        workerRunId: workerRun.id,
        taskId: workerRun.taskId,
        status: workerRun.status,
        ...(workerRun.output === undefined ? {} : { output: workerRun.output })
      },
      endedAt
    ),
    projection: {
      type: "workerRun",
      value: workerRun
    }
  });

  return workerRun;
}

export function startToolCall(options: StartToolCallOptions): ToolCall {
  const startedAt = (options.now ?? new Date()).toISOString();
  const toolCall: ToolCall = {
    id: createRunsteadId("tool"),
    workerRunId: options.workerRun.id,
    taskId: options.task.id,
    actionType: options.action.actionType,
    status: "requested",
    input: jsonObject({
      action: options.action
    }),
    startedAt
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      "tool_call.requested",
      "tool_call",
      toolCall.id,
      {
        toolCallId: toolCall.id,
        workerRunId: toolCall.workerRunId,
        taskId: toolCall.taskId,
        actionId: options.action.actionId,
        actionType: toolCall.actionType
      },
      startedAt
    ),
    projection: {
      type: "toolCall",
      value: toolCall
    }
  });

  return toolCall;
}

export function finishToolCall(options: FinishToolCallOptions): ToolCall {
  const endedAt = (options.now ?? new Date()).toISOString();
  const toolCall: ToolCall = {
    ...options.toolCall,
    status: options.status,
    ...(options.policyDecisionId === undefined
      ? {}
      : { policyDecisionId: options.policyDecisionId }),
    ...(options.output === undefined ? {} : { output: options.output }),
    endedAt
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      `tool_call.${options.status}`,
      "tool_call",
      toolCall.id,
      {
        toolCallId: toolCall.id,
        workerRunId: toolCall.workerRunId,
        taskId: toolCall.taskId,
        actionType: toolCall.actionType,
        status: toolCall.status,
        ...(toolCall.policyDecisionId === undefined
          ? {}
          : { policyDecisionId: toolCall.policyDecisionId }),
        ...(toolCall.output === undefined ? {} : { output: toolCall.output })
      },
      endedAt
    ),
    projection: {
      type: "toolCall",
      value: toolCall
    }
  });

  return toolCall;
}

function runtimeEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType,
    aggregateId,
    payload,
    createdAt
  };
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
