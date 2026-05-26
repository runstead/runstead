import type { Task } from "@runstead/core";

import type { CiRepairWorkerKind } from "./ci-repair-orchestrator.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";

export function isRunnableCiRepairTask(task: Task): boolean {
  return (
    task.domain === "repo-maintenance" &&
    task.type === "ci_repair" &&
    task.status === "queued" &&
    ciRepairTaskRunId(task) !== undefined &&
    task.input.logEvidenceType === "github_workflow_run" &&
    isRecord(task.input.workflowRun) &&
    verifierCommandsFromCiRepairTask(task).length > 0
  );
}

export function ciRepairTaskRunId(task: Task): string | undefined {
  const runId = task.input.runId;

  if (typeof runId === "string" || typeof runId === "number") {
    return String(runId);
  }

  return undefined;
}

export function workerFromCiRepairTask(task: Task): CiRepairWorkerKind | undefined {
  const worker = task.input.worker;

  if (worker === "codex_cli" || worker === "claude_code" || worker === "codex_direct") {
    return worker;
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedWorker = context.requestedWorker;
  const workerResult = context.workerResult;

  if (
    requestedWorker === "codex_cli" ||
    requestedWorker === "claude_code" ||
    requestedWorker === "codex_direct"
  ) {
    return requestedWorker;
  }

  if (isRecord(workerResult)) {
    const completedWorker = workerResult.worker;

    if (
      completedWorker === "codex_cli" ||
      completedWorker === "claude_code" ||
      completedWorker === "codex_direct"
    ) {
      return completedWorker;
    }
  }

  return undefined;
}

export function modelFromCiRepairTask(task: Task): string | undefined {
  const model = task.input.model;

  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedModel = context.requestedModel;

  return typeof requestedModel === "string" && requestedModel.trim().length > 0
    ? requestedModel.trim()
    : undefined;
}

export function providerFromCiRepairTask(task: Task): string | undefined {
  const provider = task.input.provider;

  if (typeof provider === "string" && provider.trim().length > 0) {
    return provider.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedProvider = context.requestedProvider;

  return typeof requestedProvider === "string" && requestedProvider.trim().length > 0
    ? requestedProvider.trim()
    : undefined;
}

export function baseUrlFromCiRepairTask(task: Task): string | undefined {
  const baseUrl = task.input.baseUrl;

  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    return baseUrl.trim();
  }

  const context = task.output?.ciRepairOrchestrator;

  if (!isRecord(context)) {
    return undefined;
  }

  const requestedBaseUrl = context.requestedBaseUrl;

  return typeof requestedBaseUrl === "string" && requestedBaseUrl.trim().length > 0
    ? requestedBaseUrl.trim()
    : undefined;
}

export function verifierCommandsFromCiRepairTask(task: Task): CommandVerifierInput[] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
