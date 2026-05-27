import { dirname } from "node:path";
import type { WorkerRun } from "@runstead/core";

import { applyWorkspacePatch } from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand, type ShellCommandResult } from "../shell-executor.js";
import type { CodexDirectWorkerOptions } from "./worker.js";
import { governedToolOptions } from "./policy-actions.js";
import {
  evidenceReadAction,
  filesystemPatchAction,
  shellAction,
  verifierRunAction,
  workspaceFactsReadAction
} from "./policy-actions.js";
import { previewText, shellCommandOutput } from "./tool-arguments.js";
import {
  codexDirectPatchApprovalMetadata,
  codexDirectPatchFilesTouched,
  codexDirectPendingPatchPayload,
  type CodexDirectPendingToolResumeContext
} from "./patch-actions.js";
import {
  readEvidenceArtifact,
  readWorkspaceFacts,
  resolveVerifierCommand
} from "./evidence-actions.js";
import { storeCommandVerifierEvidence } from "../verifier-evidence.js";

export {
  runGovernedDiffSummary,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow
} from "./git-read-tools.js";

export {
  runGovernedFileInfo,
  runGovernedListFiles,
  runGovernedReadManyFiles,
  runGovernedSearchText,
  runGovernedTree
} from "./workspace-read-tools.js";
export { runGovernedPackageScripts } from "./workspace-metadata-tools.js";

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

export async function runGovernedApplyPatch(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    resumeContext?: CodexDirectPendingToolResumeContext;
    patch?: string;
    replacements?: {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    }[];
  }
) {
  const filesTouched = codexDirectPatchFilesTouched(options);
  const approvalMetadata = codexDirectPatchApprovalMetadata({
    cwd: options.cwd,
    task: options.task,
    filesTouched,
    ...(options.patch === undefined ? {} : { patch: options.patch }),
    ...(options.replacements === undefined
      ? {}
      : { replacements: options.replacements })
  });

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemPatchAction({
      cwd: options.cwd,
      filesTouched,
      approvalMetadata,
      pendingPatch: codexDirectPendingPatchPayload({
        filesTouched,
        approvalMetadata,
        ...(options.resumeContext === undefined
          ? {}
          : { resumeContext: options.resumeContext }),
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      }),
      stableParts: [options.cwd, options.patch, options.replacements ?? []]
    }),
    run: async () => {
      const value = await applyWorkspacePatch(options.cwd, {
        ...(options.patch === undefined ? {} : { patch: options.patch }),
        ...(options.replacements === undefined
          ? {}
          : { replacements: options.replacements })
      });

      return {
        value,
        output: {
          mode: value.mode,
          filesTouched: value.filesTouched,
          applied: value.applied
        }
      };
    }
  }).then((result) => result.value);
}

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
