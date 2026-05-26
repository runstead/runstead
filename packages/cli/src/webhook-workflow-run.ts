import type { RunsteadEvent } from "@runstead/core";

import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  createCiRepairTaskFromWorkflowRun,
  repairableWorkflowRunIdFromWebhook
} from "./ci-repair.js";
import {
  runCiRepairOrchestrator,
  type CiRepairWorkerKind
} from "./ci-repair-orchestrator.js";
import {
  findRecordedGitHubWebhookDelivery,
  recordGitHubWebhookDeliveryReceivedEvent,
  type HandleGitHubWorkflowRunWebhookResult,
  type RecordGitHubWorkflowRunWebhookEventOptions
} from "./webhook-workflow-run-audit.js";

export {
  recordGitHubWebhookDeliveryReceivedEvent,
  recordGitHubWorkflowRunWebhookEvent
} from "./webhook-workflow-run-audit.js";
export type {
  HandleGitHubWorkflowRunWebhookResult,
  RecordGitHubWebhookDeliveryReceivedEventOptions,
  RecordGitHubWorkflowRunWebhookEventOptions
} from "./webhook-workflow-run-audit.js";

export type GitHubWorkflowRunWebhookMode = "intake" | "orchestrate";

export interface HandleGitHubWorkflowRunWebhookOptions {
  event: string;
  delivery?: string;
  payload: unknown;
  cwd?: string;
  authToken?: string;
  mode?: GitHubWorkflowRunWebhookMode;
  dedupeDelivery?: boolean;
  worker?: CiRepairWorkerKind;
  provider?: string;
  model?: string;
  baseUrl?: string;
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
  if (options.dedupeDelivery === true && options.delivery !== undefined) {
    const duplicate = findRecordedGitHubWebhookDelivery({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      delivery: options.delivery
    });

    if (duplicate !== undefined) {
      const result: HandleGitHubWorkflowRunWebhookResult = {
        handled: false,
        reason: "duplicate_delivery",
        delivery: options.delivery,
        originalEventId: duplicate.eventId,
        originalEventType: duplicate.type
      };

      await auditWebhookResult(options, result);

      return result;
    }

    recordGitHubWebhookDeliveryReceivedEvent({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      event: options.event,
      delivery: options.delivery,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

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
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.base === undefined ? {} : { base: options.base }),
      draft: options.draft === true,
      allowedPaths: options.allowedPaths ?? [],
      deniedPaths: options.deniedPaths ?? [],
      verifierCommands,
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.now === undefined ? {} : { now: options.now })
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
      : { verifierCommands: options.verifierCommands }),
    ...(options.now === undefined ? {} : { now: options.now })
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
    ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
    result,
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
