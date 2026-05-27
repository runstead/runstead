import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task,
  type ToolCall,
  type ToolCallStatus,
  type WorkerRun
} from "@runstead/core";
import {
  appendEventAndProject,
  type AppendEventAndProjectInput,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import type { ActionEnvelope } from "./policy.js";
import { jsonObject, runtimeEvent } from "./runtime-audit-events.js";

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

export interface ToolCallTransition {
  toolCall: ToolCall;
  event: RunsteadEvent;
  entry: AppendEventAndProjectInput;
}

export function createStartToolCallTransition(
  options: Omit<StartToolCallOptions, "database">
): ToolCallTransition {
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

  const event = runtimeEvent(
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
  );

  return {
    toolCall,
    event,
    entry: {
      event,
      projection: {
        type: "toolCall",
        value: toolCall
      }
    }
  };
}

export function startToolCall(options: StartToolCallOptions): ToolCall {
  const transition = createStartToolCallTransition(options);

  appendEventAndProject(options.database, transition.entry);

  return transition.toolCall;
}

export function createFinishToolCallTransition(
  options: Omit<FinishToolCallOptions, "database">
): ToolCallTransition {
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

  const event = runtimeEvent(
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
  );

  return {
    toolCall,
    event,
    entry: {
      event,
      projection: {
        type: "toolCall",
        value: toolCall
      }
    }
  };
}

export function finishToolCall(options: FinishToolCallOptions): ToolCall {
  const transition = createFinishToolCallTransition(options);

  appendEventAndProject(options.database, transition.entry);

  return transition.toolCall;
}
