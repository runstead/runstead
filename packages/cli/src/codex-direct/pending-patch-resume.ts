import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { applyWorkspacePatch } from "../codex-direct-native-tools.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import { startWorkerRun } from "../runtime-audit.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  DEFAULT_CODEX_DIRECT_MAX_TURNS
} from "./constants.js";
import { runCodexDirectConversation } from "./conversation.js";
import {
  completedWorkerResult,
  CodexDirectModelTimeoutError,
  governedToolOptions,
  modelTimeoutInterruption,
  parsePendingPatchAction
} from "./tool-router.js";
import type {
  CodexDirectPendingPatchResume,
  CodexDirectPendingPatchResumeOptions,
  CodexDirectWorkerResult
} from "./worker-types.js";

export async function runCodexDirectPendingPatchResume(
  options: CodexDirectPendingPatchResumeOptions
): Promise<CodexDirectWorkerResult> {
  const workerRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: CODEX_DIRECT_WORKER_KIND,
    enforcementLevel: "hard_proxy_tool_calls",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  try {
    const governed = await runGovernedToolAction({
      ...governedToolOptions({ ...options, workerRun }),
      action: options.pendingPatch.action,
      run: async () => {
        const value = await applyWorkspacePatch(options.cwd, {
          ...(options.pendingPatch.pendingPatch.patch === undefined
            ? {}
            : { patch: options.pendingPatch.pendingPatch.patch }),
          ...(options.pendingPatch.pendingPatch.replacements === undefined
            ? {}
            : { replacements: options.pendingPatch.pendingPatch.replacements })
        });

        return {
          value,
          output: {
            mode: value.mode,
            filesTouched: value.filesTouched,
            applied: value.applied,
            approvalId: options.pendingPatch.approvalId,
            policyDecisionId: options.pendingPatch.policyDecisionId,
            resume: "approved_pending_patch"
          }
        };
      }
    });
    const output = JSON.stringify({
      mode: governed.value.mode,
      filesTouched: governed.value.filesTouched,
      applied: governed.value.applied,
      approvalId: options.pendingPatch.approvalId,
      policyDecisionId: options.pendingPatch.policyDecisionId,
      resume: "approved_pending_patch"
    });
    const resumeContext = options.pendingPatch.pendingPatch.resumeContext;

    if (resumeContext === undefined || options.transport === undefined) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "completed",
        exitCode: 0,
        summary: "Applied approved pending patch without regenerating model output.",
        toolCalls: 1,
        failedToolCalls: 0,
        warnings: [
          `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
          ...(resumeContext === undefined
            ? [
                "Approved patch lacked durable conversation context; model loop continuation was skipped."
              ]
            : []),
          ...(options.transport === undefined
            ? [
                "Codex Direct transport was unavailable; model loop continuation was skipped."
              ]
            : [])
        ]
      });
    }

    return runCodexDirectConversation({
      options: {
        ...options,
        transport: options.transport,
        modelProviderNetworkDomains: options.modelProviderNetworkDomains ?? [
          "chatgpt.com"
        ]
      },
      workerRun,
      messages: [
        ...resumeContext.messages,
        resumeContext.toolCall,
        {
          type: "function_call_output",
          call_id: resumeContext.toolCall.call_id,
          output
        }
      ],
      maxTurns: options.maxTurns ?? DEFAULT_CODEX_DIRECT_MAX_TURNS,
      executedToolCalls: 1,
      failedToolCalls: 0,
      warnings: [
        `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
        "Continued the Codex Direct model loop from the approved tool call."
      ]
    });
  } catch (error) {
    if (error instanceof ToolActionApprovalRequiredError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "waiting_approval",
        exitCode: 2,
        summary: error.message,
        toolCalls: 1,
        failedToolCalls: 0,
        approval: {
          id: error.approval.id,
          actionId: error.approval.actionId,
          policyDecisionId: error.policyDecision.id,
          reason: error.approval.reason
        }
      });
    }

    if (error instanceof ToolActionDeniedError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "blocked",
        exitCode: 3,
        summary: error.message,
        toolCalls: 1,
        failedToolCalls: 0
      });
    }

    if (error instanceof CodexDirectModelTimeoutError) {
      return completedWorkerResult({
        options,
        workerRun,
        status: "interrupted",
        exitCode: 124,
        summary: error.message,
        toolCalls: 1,
        failedToolCalls: 0,
        warnings: [
          `Resumed from approved pending patch ${options.pendingPatch.approvalId}.`,
          "Codex Direct model request timed out; the task is recoverable with runstead resume."
        ],
        interruption: modelTimeoutInterruption(options, error)
      });
    }

    return completedWorkerResult({
      options,
      workerRun,
      status: "failed",
      exitCode: 1,
      summary: error instanceof Error ? error.message : String(error),
      toolCalls: 1,
      failedToolCalls: 1
    });
  }
}

export function readApprovedCodexDirectPendingPatch(
  database: RunsteadDatabase,
  approvalId: string
): CodexDirectPendingPatchResume | undefined {
  const row = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.status, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.id = ?
    `
    )
    .get(approvalId) as
    | {
        approval_id: string;
        status: string;
        policy_decision_id: string;
        action_json: string;
      }
    | undefined;

  if (row === undefined) {
    return undefined;
  }

  const action = parsePendingPatchAction(row.action_json);

  if (action === undefined) {
    return undefined;
  }

  if (row.status !== "approved") {
    return readApprovedCodexDirectPendingPatchBySignature(
      database,
      action.context.pendingPatch.canonicalSignature
    );
  }

  return {
    approvalId: row.approval_id,
    policyDecisionId: row.policy_decision_id,
    action,
    pendingPatch: action.context.pendingPatch
  };
}

function readApprovedCodexDirectPendingPatchBySignature(
  database: RunsteadDatabase,
  canonicalSignature: string
): CodexDirectPendingPatchResume | undefined {
  const rows = database
    .prepare(
      `
      SELECT a.id AS approval_id, a.policy_decision_id, pd.action_json
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      WHERE a.status = 'approved'
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 50
    `
    )
    .all() as {
    approval_id: string;
    policy_decision_id: string;
    action_json: string;
  }[];

  for (const row of rows) {
    const action = parsePendingPatchAction(row.action_json);

    if (action?.context.pendingPatch.canonicalSignature !== canonicalSignature) {
      continue;
    }

    return {
      approvalId: row.approval_id,
      policyDecisionId: row.policy_decision_id,
      action,
      pendingPatch: action.context.pendingPatch
    };
  }

  return undefined;
}
