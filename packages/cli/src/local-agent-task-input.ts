import type { Task } from "@runstead/core";

import type { CiRepairWorkerKind } from "./ci-repair-orchestrator-types.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export type LocalAgentMode = "read-only" | "edit" | "repair";
export type LocalAgentWorkerKind = CiRepairWorkerKind;

export function localAgentTaskWorker(task: Task): LocalAgentWorkerKind {
  const worker = task.input.worker;

  if (worker === "codex_direct" || worker === "codex_cli" || worker === "claude_code") {
    return worker;
  }

  return "codex_direct";
}

export function localAgentTaskMode(task: Task): LocalAgentMode {
  const mode = task.input.mode;

  if (mode === "read-only" || mode === "edit" || mode === "repair") {
    return mode;
  }

  return "read-only";
}

export function localAgentTaskNeedsCheckpoint(task: Task): boolean {
  return localAgentTaskMode(task) !== "read-only" && task.input.checkpoint !== false;
}

export function localAgentShouldIncrementAttempt(task: Task): boolean {
  const approval = task.output?.approval;

  return !isRecord(approval) || approval.status !== "approved";
}

export function localAgentTaskModel(task: Task): string | undefined {
  const model = task.input.model;

  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : undefined;
}

export function localAgentTaskProvider(task: Task): string | undefined {
  const provider = task.input.provider;

  return typeof provider === "string" && provider.trim().length > 0
    ? provider.trim()
    : undefined;
}

export function localAgentTaskBaseUrl(task: Task): string | undefined {
  const baseUrl = task.input.baseUrl;

  return typeof baseUrl === "string" && baseUrl.trim().length > 0
    ? baseUrl.trim()
    : undefined;
}

export function localAgentTaskCheckpointId(task: Task): string | undefined {
  const checkpointId = task.output?.checkpointId;

  return typeof checkpointId === "string" && checkpointId.trim().length > 0
    ? checkpointId.trim()
    : undefined;
}

export function localAgentTaskStringArray(task: Task, field: string): string[] {
  const value = task.input[field];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function localAgentTaskMaxTurns(task: Task): number | undefined {
  const maxTurns = task.input.maxTurns;

  return typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0
    ? maxTurns
    : undefined;
}

export function localAgentTaskToolBudget(task: Task): {
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
} {
  return {
    ...positiveIntegerInput(task, "maxToolCalls"),
    ...positiveIntegerInput(task, "maxFailedToolCalls")
  };
}

export function localAgentTaskModelRequestTiming(task: Task): {
  modelRequestTimeoutMs?: number;
  modelRequestHeartbeatMs?: number;
} {
  return {
    ...positiveIntegerInput(task, "modelRequestTimeoutMs"),
    ...positiveIntegerInput(task, "modelRequestHeartbeatMs")
  };
}

export function localAgentTaskFinalizeOnBudget(task: Task): boolean {
  const value = task.input.finalizeOnBudget;

  return typeof value === "boolean" ? value : localAgentTaskMode(task) === "read-only";
}

export function verifierCommandsFromLocalAgentTask(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command): CommandVerifierInput[] => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [
          {
            name,
            command: commandText
          }
        ]
      : [];
  });
}

function positiveIntegerInput(task: Task, field: string): Record<string, number> {
  const value = task.input[field];

  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? { [field]: value }
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
