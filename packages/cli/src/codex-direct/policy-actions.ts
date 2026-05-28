import type { Task, WorkerRun } from "@runstead/core";

import type { ActionEnvelope } from "../policy.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";
import { stableActionId } from "./tool-action-id.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export {
  evidenceReadAction,
  filesystemReadAction,
  gitReadAction,
  repositoryMetadataReadAction,
  workspaceFactsReadAction
} from "./read-policy-actions.js";
export { modelInferenceAction } from "./model-policy-actions.js";
export { filesystemPatchAction } from "./patch-policy-actions.js";
export { shellAction } from "./shell-policy-actions.js";

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
