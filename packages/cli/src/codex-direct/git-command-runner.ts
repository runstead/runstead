import type { JsonObject, WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand, type ShellCommandResult } from "../shell-executor.js";
import { gitReadAction, governedToolOptions } from "./policy-actions.js";
import { shellCommandOutput } from "./tool-output.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedGitCommand<T extends JsonObject>(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    actionType: "git.log" | "git.show";
    command: string;
    maxBytes?: number;
    output: (result: ShellCommandResult) => T;
  }
): Promise<T> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: options.actionType
    }),
    run: async () => {
      const value = await runShellCommand({
        command: options.command,
        cwd: options.cwd,
        ...(options.maxBytes === undefined ? {} : { maxOutputBytes: options.maxBytes })
      });
      const output = shellCommandOutput(value);

      return {
        value: options.output(value),
        output
      };
    }
  }).then((result) => result.value);
}
