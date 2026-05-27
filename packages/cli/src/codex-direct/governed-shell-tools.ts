import type { WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand, type ShellCommandResult } from "../shell-executor.js";
import { governedToolOptions, shellAction } from "./policy-actions.js";
import { shellCommandOutput } from "./tool-output.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedShellCommand(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    command: string;
    timeoutMs?: number;
  }
): Promise<ShellCommandResult> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: shellAction({
      cwd: options.cwd,
      command: options.command
    }),
    run: async () => {
      const value = await runShellCommand({
        command: options.command,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

      return {
        value,
        output: shellCommandOutput(value)
      };
    }
  }).then((result) => result.value);
}
