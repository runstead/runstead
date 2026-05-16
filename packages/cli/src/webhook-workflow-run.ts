import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { CommandVerifierInput } from "./verifier-evidence.js";
import {
  createCiRepairTaskFromWorkflowRun,
  repairableWorkflowRunIdFromWebhook,
  type CreateCiRepairTaskFromWorkflowRunResult
} from "./ci-repair.js";
import {
  runCiRepairOrchestrator,
  type CiRepairWorkerKind,
  type RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator.js";
import {
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";

export type GitHubWorkflowRunWebhookMode = "intake" | "orchestrate";

export type HandleGitHubWorkflowRunWebhookResult =
  | {
      handled: false;
      reason: "not_repairable_workflow_run";
    }
  | {
      handled: false;
      reason: "duplicate_delivery";
      delivery: string;
      originalEventId: string;
      originalEventType: string;
    }
  | {
      handled: true;
      mode: "intake";
      runId: string;
      ciRepair: CreateCiRepairTaskFromWorkflowRunResult;
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
  delivery?: string;
  result: HandleGitHubWorkflowRunWebhookResult;
  now?: Date;
}

export interface RecordGitHubWebhookDeliveryReceivedEventOptions {
  cwd?: string;
  event: string;
  delivery: string;
  now?: Date;
}

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

interface WebhookDeliveryEventRow {
  event_id: string;
  type: string;
  payload_json: string;
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

export function recordGitHubWorkflowRunWebhookEvent(
  options: RecordGitHubWorkflowRunWebhookEventOptions
): Promise<RunsteadEvent> {
  const root = requireRunsteadRootSync(resolve(options.cwd ?? process.cwd())).root;
  const stateDb = join(root, "state.db");
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: webhookAuditEventType(options.result),
    aggregateType: webhookAuditAggregateType(options.result),
    aggregateId: webhookAuditAggregateId(options.event, options.result),
    payload: webhookAuditPayload(options.event, options.delivery, options.result),
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

export function recordGitHubWebhookDeliveryReceivedEvent(
  options: RecordGitHubWebhookDeliveryReceivedEventOptions
): RunsteadEvent {
  const root = requireRunsteadRootSync(resolve(options.cwd ?? process.cwd())).root;
  const stateDb = join(root, "state.db");
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "webhook.delivery_received",
    aggregateType: "github_webhook_delivery",
    aggregateId: options.delivery,
    payload: {
      sourceEvent: options.event,
      delivery: options.delivery
    },
    createdAt: (options.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
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

function findRecordedGitHubWebhookDelivery(options: {
  cwd?: string;
  delivery: string;
}): { eventId: string; type: string } | undefined {
  const state = requireRunsteadStateDbSync(resolve(options.cwd ?? process.cwd()));
  const database = openRunsteadDatabase(state.stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT event_id, type, payload_json
        FROM events
        WHERE type IN (
          'webhook.delivery_received',
          'webhook.workflow_run_handled',
          'webhook.workflow_run_ignored',
          'webhook.delivery_duplicate'
        )
        ORDER BY id DESC
      `
      )
      .all() as unknown as WebhookDeliveryEventRow[];

    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;

      if (payload.delivery === options.delivery) {
        return {
          eventId: row.event_id,
          type: row.type
        };
      }
    }

    return undefined;
  } finally {
    database.close();
  }
}

function webhookAuditEventType(result: HandleGitHubWorkflowRunWebhookResult): string {
  if (result.handled) {
    return "webhook.workflow_run_handled";
  }

  return result.reason === "duplicate_delivery"
    ? "webhook.delivery_duplicate"
    : "webhook.workflow_run_ignored";
}

function webhookAuditAggregateType(
  result: HandleGitHubWorkflowRunWebhookResult
): string {
  if (result.handled) {
    return "github_workflow_run";
  }

  return result.reason === "duplicate_delivery"
    ? "github_webhook_delivery"
    : "github_webhook";
}

function webhookAuditAggregateId(
  event: string,
  result: HandleGitHubWorkflowRunWebhookResult
): string {
  if (result.handled) {
    return result.runId;
  }

  return result.reason === "duplicate_delivery" ? result.delivery : event;
}

function webhookAuditPayload(
  event: string,
  delivery: string | undefined,
  result: HandleGitHubWorkflowRunWebhookResult
): Record<string, unknown> {
  const base = {
    sourceEvent: event,
    ...(delivery === undefined ? {} : { delivery })
  };

  if (!result.handled) {
    return result.reason === "duplicate_delivery"
      ? {
          ...base,
          handled: false,
          reason: result.reason,
          originalEventId: result.originalEventId,
          originalEventType: result.originalEventType
        }
      : {
          ...base,
          handled: false,
          reason: result.reason
        };
  }

  if (result.mode === "intake") {
    return {
      ...base,
      mode: result.mode,
      runId: result.runId,
      taskId: result.ciRepair.task.id,
      status: result.ciRepair.status,
      taskStatus: result.ciRepair.task.status,
      ...(result.ciRepair.status === "ignored"
        ? { reason: result.ciRepair.reason }
        : {}),
      created: result.ciRepair.created
    };
  }

  if (
    result.orchestration.status === "ignored" &&
    result.orchestration.ciRepair.status === "ignored"
  ) {
    return {
      ...base,
      mode: result.mode,
      runId: result.runId,
      taskId: result.orchestration.ciRepair.task.id,
      status: result.orchestration.status,
      reason: result.orchestration.ciRepair.reason,
      taskStatus: result.orchestration.ciRepair.taskStatus
    };
  }

  return {
    ...base,
    mode: result.mode,
    runId: result.runId,
    taskId: result.orchestration.ciRepair.task.id,
    status: result.orchestration.status,
    ...(result.orchestration.approval === undefined
      ? {}
      : { approvalId: result.orchestration.approval.id })
  };
}
