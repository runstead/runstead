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

export type GitHubWorkflowRunWebhookMode = "intake" | "orchestrate";

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
}

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

export async function handleGitHubWorkflowRunWebhook(
  options: HandleGitHubWorkflowRunWebhookOptions
): Promise<HandleGitHubWorkflowRunWebhookResult> {
  const runId = repairableWorkflowRunIdFromWebhook(options.event, options.payload);

  if (runId === undefined) {
    return {
      handled: false,
      reason: "not_repairable_workflow_run"
    };
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

    return {
      handled: true,
      mode: "orchestrate",
      runId,
      orchestration
    };
  }

  const ciRepair = await (options.intake ?? createCiRepairTaskFromWorkflowRun)({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    ...(options.verifierCommands === undefined
      ? {}
      : { verifierCommands: options.verifierCommands })
  });

  return {
    handled: true,
    mode: "intake",
    runId,
    ciRepair
  };
}
