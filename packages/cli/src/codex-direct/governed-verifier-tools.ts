import { dirname } from "node:path";
import type { WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { storeCommandVerifierEvidence } from "../verifier-evidence.js";
import { governedToolOptions, verifierRunAction } from "./policy-actions.js";
import { previewText } from "./tool-output.js";
import { resolveVerifierCommand } from "./verifier-command-resolution.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedVerifier(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    name: string;
    timeoutMs?: number;
  }
) {
  const command = await resolveVerifierCommand(options);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: verifierRunAction({
      task: options.task,
      cwd: options.cwd,
      command
    }),
    run: async () => {
      const value = await storeCommandVerifierEvidence({
        cwd: options.cwd,
        runsteadRoot: dirname(options.evidenceDir),
        database: options.database,
        task: options.task,
        command,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value: {
          verifier: command.name,
          command: value.artifact.command,
          exitCode: value.artifact.result.exitCode,
          timedOut: value.artifact.result.timedOut,
          forceKilled: value.artifact.result.forceKilled,
          evidenceId: value.evidence.id,
          artifactPath: value.artifactPath,
          stdoutPreview: previewText(value.artifact.result.stdout),
          stderrPreview: previewText(value.artifact.result.stderr),
          stdoutTruncated: value.artifact.result.stdoutTruncated,
          stderrTruncated: value.artifact.result.stderrTruncated
        },
        output: {
          verifier: command.name,
          exitCode: value.artifact.result.exitCode,
          timedOut: value.artifact.result.timedOut,
          evidenceId: value.evidence.id,
          artifactPath: value.artifactPath
        }
      };
    }
  }).then((result) => result.value);
}
