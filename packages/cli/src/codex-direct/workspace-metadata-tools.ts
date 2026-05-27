import type { WorkerRun } from "@runstead/core";

import { inspectPackageScripts } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { governedToolOptions, repositoryMetadataReadAction } from "./policy-actions.js";
import { type CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedPackageScripts(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: repositoryMetadataReadAction({
      cwd: options.cwd,
      path: options.path
    }),
    run: async () => {
      const value = await inspectPackageScripts(options.cwd, {
        path: options.path
      });

      return {
        value,
        output: {
          path: value.path,
          packageManager: value.packageManager,
          scripts: value.scripts.length,
          verifierCandidates: value.verifierCandidates.length,
          turboTasks: value.workspace.turboTasks.length
        }
      };
    }
  }).then((result) => result.value);
}
