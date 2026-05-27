import type { WorkerRun } from "@runstead/core";

import { runGovernedToolAction } from "../governed-action.js";
import { readEvidenceArtifact } from "./evidence-artifact-reader.js";
import { readWorkspaceFacts } from "./evidence-actions.js";
import {
  evidenceReadAction,
  governedToolOptions,
  workspaceFactsReadAction
} from "./policy-actions.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function runGovernedWorkspaceFacts(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    refresh: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: workspaceFactsReadAction({
      cwd: options.cwd,
      refresh: options.refresh
    }),
    run: async () => {
      const value = await readWorkspaceFacts({
        cwd: options.cwd,
        evidenceDir: options.evidenceDir,
        database: options.database,
        refresh: options.refresh,
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        value,
        output: {
          cached: value.cached,
          evidenceId: value.evidence.id,
          gitDetected: value.facts.git.isGitRepo,
          packageManager: value.facts.packageManager.packageManager ?? "none"
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedReadEvidence(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    id: string;
    maxBytes?: number;
  }
) {
  const maxBytes = Math.min(options.maxBytes ?? 64 * 1024, 1024 * 1024);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: evidenceReadAction({
      cwd: options.cwd,
      evidenceId: options.id
    }),
    run: async () => {
      const value = await readEvidenceArtifact({
        database: options.database,
        evidenceId: options.id,
        maxBytes
      });

      return {
        value,
        output: {
          evidenceId: value.evidence.id,
          type: value.evidence.type,
          artifactBytes: value.artifact?.bytes ?? 0,
          returnedBytes: value.artifact?.returnedBytes ?? 0,
          truncated: value.artifact?.truncated ?? false
        }
      };
    }
  }).then((result) => result.value);
}
