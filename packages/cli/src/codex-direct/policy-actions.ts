import type { Task, WorkerRun } from "@runstead/core";

import type { ActionEnvelope } from "../policy.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";
import type {
  CodexDirectPatchApprovalMetadata,
  CodexDirectPendingPatchPayload
} from "./patch-actions.js";
import { stableActionId } from "./tool-action-id.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export {
  evidenceReadAction,
  filesystemReadAction,
  gitReadAction,
  repositoryMetadataReadAction,
  workspaceFactsReadAction
} from "./read-policy-actions.js";

export function governedToolOptions(
  options: Pick<
    CodexDirectWorkerOptions,
    "cwd" | "stateDb" | "database" | "policy" | "task" | "now"
  > & { workerRun: WorkerRun }
) {
  return {
    cwd: options.cwd,
    stateDb: options.stateDb,
    database: options.database,
    policy: options.policy,
    task: options.task,
    workerRun: options.workerRun,
    requestedBy: "runstead:codex-direct",
    ...(options.now === undefined ? {} : { now: options.now })
  };
}

export function shellAction(input: { cwd: string; command: string }): ActionEnvelope {
  return {
    actionId: stableActionId("shell.exec", [input.cwd, input.command]),
    actionType: "shell.exec",
    resource: {
      type: "process",
      id: "workspace-shell"
    },
    context: {
      cwd: input.cwd,
      command: input.command,
      sideEffects: ["execute_process"]
    }
  };
}

export function filesystemPatchAction(input: {
  cwd: string;
  filesTouched: string[];
  approvalMetadata: CodexDirectPatchApprovalMetadata;
  pendingPatch: CodexDirectPendingPatchPayload;
  stableParts: unknown[];
}): ActionEnvelope {
  return {
    actionId: stableActionId("filesystem.patch", input.stableParts),
    actionType: "filesystem.patch",
    resource: {
      type: "file",
      path: input.filesTouched[0] ?? "."
    },
    context: {
      cwd: input.cwd,
      filesTouched: input.filesTouched,
      diffHash: input.approvalMetadata.diffHash,
      riskClass: input.approvalMetadata.riskClass,
      dependencyImpact: input.approvalMetadata.dependencyImpact,
      riskSummary: input.approvalMetadata.riskSummary,
      canonicalSignature: input.approvalMetadata.canonicalSignature,
      ...(input.approvalMetadata.approvalGrant === undefined
        ? {}
        : { approvalGrant: input.approvalMetadata.approvalGrant }),
      pendingPatch: input.pendingPatch,
      sideEffects: ["write_workspace"]
    }
  };
}

export function verifierRunAction(input: {
  task: Task;
  cwd: string;
  command: CommandVerifierInput;
}): ActionEnvelope {
  return {
    actionId: stableActionId("verifier.run", [
      input.task.id,
      input.command.name,
      input.command.command
    ]),
    actionType: "verifier.run",
    resource: {
      type: "verifier",
      id: input.command.name
    },
    context: {
      cwd: input.cwd,
      command: input.command.command,
      sideEffects: ["execute_process", "read_workspace"]
    }
  };
}

export function modelInferenceAction(input: {
  task: Task;
  model: string;
  providerResourceId?: string;
  networkDomains?: string[];
}): ActionEnvelope {
  const providerResourceId = input.providerResourceId ?? "chatgpt_codex";

  return {
    actionId: stableActionId("model_inference_request", [
      input.task.id,
      providerResourceId,
      input.model
    ]),
    actionType: "model.inference.request",
    resource: {
      type: "model_provider",
      id: providerResourceId
    },
    context: {
      networkDomains: input.networkDomains ?? ["chatgpt.com"],
      sideEffects: ["network_write_external", "llm_data_egress"]
    }
  };
}
