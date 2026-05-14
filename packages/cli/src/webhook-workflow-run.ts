import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { WrappedWorkerKind } from "./wrapped-worker.js";
import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  createCiRepairTaskFromWorkflowRun,
  repairableWorkflowRunIdFromWebhook,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import {
  runCiRepairOrchestrator,
  type RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator.js";
import { requireRunsteadRootSync } from "./runstead-root.js";

export type GitHubWorkflowRunWebhookMode = "intake" | "orchestrate";

export type HandleGitHubWorkflowRunWebhookResult =
  | {
      handled: false;
      reason: "not_repairable_workflow_run";
    }
  | {
      handled: true;
      mode: "intake";
      runId: string;
      ciRepair: CreateCiRepairTaskResult;
    }
  | {
      handled: true;
      mode: "orchestrate";
      runId: string;
      orchestration: RunCiRepairOrchestratorResult;
    };

export interface RecordGitHubWorkflowRunWebhookEventOptions {
  cwd?: string;
  event: string;
  result: HandleGitHubWorkflowRunWebhookResult;
  now?: Date;
}

export interface HandleGitHubWorkflowRunWebhookOptions {
  event: string;
  payload: unknown;
  cwd?: string;
  authToken?: string;
  mode?: GitHubWorkflowRunWebhookMode;
  worker?: WrappedWorkerKind;
  base?: string;
  draft?: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  verifierCommands?: CommandVerifierInput[];
  intake?: typeof createCiRepairTaskFromWorkflowRun;
  orchestrate?: typeof runCiRepairOrchestrator;
  audit?: (
    options: RecordGitHubWorkflowRunWebhookEventOptions
  ) => Promise<RunsteadEvent | undefined>;
  now?: Date;
}

export async function handleGitHubWorkflowRunWebhook(
  options: HandleGitHubWorkflowRunWebhookOptions
): Promise<HandleGitHubWorkflowRunWebhookResult> {
  const runId = repairableWorkflowRunIdFromWebhook(options.event, options.payload);

  if (runId === undefined) {
    const result: HandleGitHubWorkflowRunWebhookResult = {
      handled: false,
      reason: "not_repairable_workflow_run"
    };

    await auditWebhookResult(options, result);

    return result;
  }

  if (options.mode === "orchestrate") {
    const verifierCommands = options.verifierCommands ?? [];

    if (verifierCommands.length === 0) {
      throw new Error("--verifier is required when --orchestrate-repair is set");
    }

    const orchestration = await (options.orchestrate ?? runCiRepairOrchestrator)({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      runId,
      worker: options.worker ?? "codex_cli",
      ...(options.base === undefined ? {} : { base: options.base }),
      draft: options.draft === true,
      allowedPaths: options.allowedPaths ?? [],
      deniedPaths: options.deniedPaths ?? [],
      verifierCommands,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken })
    });

    const result: HandleGitHubWorkflowRunWebhookResult = {
      handled: true,
      mode: "orchestrate",
      runId,
      orchestration
    };

    await auditWebhookResult(options, result);

    return result;
  }

  const ciRepair = await (options.intake ?? createCiRepairTaskFromWorkflowRun)({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    ...(options.verifierCommands === undefined
      ? {}
      : { verifierCommands: options.verifierCommands })
  });

  const result: HandleGitHubWorkflowRunWebhookResult = {
    handled: true,
    mode: "intake",
    runId,
    ciRepair
  };

  await auditWebhookResult(options, result);

  return result;
}

export function recordGitHubWorkflowRunWebhookEvent(
  options: RecordGitHubWorkflowRunWebhookEventOptions
): Promise<RunsteadEvent> {
  const root = requireRunsteadRootSync(resolve(options.cwd ?? process.cwd())).root;
  const stateDb = join(root, "state.db");
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: options.result.handled
      ? "webhook.workflow_run_handled"
      : "webhook.workflow_run_ignored",
    aggregateType: options.result.handled ? "github_workflow_run" : "github_webhook",
    aggregateId: options.result.handled ? options.result.runId : options.event,
    payload: webhookAuditPayload(options.event, options.result),
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return Promise.resolve(event);
}

async function auditWebhookResult(
  options: HandleGitHubWorkflowRunWebhookOptions,
  result: HandleGitHubWorkflowRunWebhookResult
): Promise<void> {
  if (options.audit === undefined) {
    return;
  }

  await options.audit({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    event: options.event,
    result,
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

function webhookAuditPayload(
  event: string,
  result: HandleGitHubWorkflowRunWebhookResult
): Record<string, unknown> {
  if (!result.handled) {
    return {
      sourceEvent: event,
      handled: false,
      reason: result.reason
    };
  }

  if (result.mode === "intake") {
    return {
      sourceEvent: event,
      mode: result.mode,
      runId: result.runId,
      taskId: result.ciRepair.task.id,
      taskStatus: result.ciRepair.task.status,
      created: result.ciRepair.created
    };
  }

  return {
    sourceEvent: event,
    mode: result.mode,
    runId: result.runId,
    taskId: result.orchestration.ciRepair.task.id,
    status: result.orchestration.status,
    ...(result.orchestration.approval === undefined
      ? {}
      : { approvalId: result.orchestration.approval.id })
  };
}
