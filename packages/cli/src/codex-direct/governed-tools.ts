import { dirname } from "node:path";
import type { JsonObject, WorkerRun } from "@runstead/core";

import {
  applyWorkspacePatch,
  inspectPackageScripts,
  inspectWorkspacePath,
  listWorkspaceFiles,
  readManyWorkspaceFiles,
  searchWorkspaceText,
  workspaceTree
} from "../codex-direct-native-tools.js";
import { runGovernedToolAction } from "../governed-action.js";
import { runShellCommand, type ShellCommandResult } from "../shell-executor.js";
import type { CodexDirectWorkerOptions } from "./worker.js";
import { governedToolOptions } from "./policy-actions.js";
import {
  evidenceReadAction,
  filesystemPatchAction,
  filesystemReadAction,
  gitReadAction,
  repositoryMetadataReadAction,
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
import {
  diffSummaryTotals,
  firstNonZeroExitCode,
  gitDiffSummaryCommand,
  gitLogCommand,
  gitShowCommand,
  mergeDiffSummaryRows,
  parseGitLogOutput
} from "./git-actions.js";
import { storeCommandVerifierEvidence } from "../verifier-evidence.js";

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

export async function runGovernedDiffSummary(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path?: string;
    staged: boolean;
    base?: string;
    maxFiles?: number;
  }
) {
  const maxFiles = Math.min(options.maxFiles ?? 100, 1_000);
  const input = {
    path: options.path,
    staged: options.staged,
    base: options.base
  };
  const numstatCommand = gitDiffSummaryCommand("--numstat", input);
  const nameStatusCommand = gitDiffSummaryCommand("--name-status", input);
  const shortstatCommand = gitDiffSummaryCommand("--shortstat", input);

  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: "git.diff.summary"
    }),
    run: async () => {
      const [numstat, nameStatus, shortstat] = await Promise.all([
        runShellCommand({
          command: numstatCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: nameStatusCommand,
          cwd: options.cwd
        }),
        runShellCommand({
          command: shortstatCommand,
          cwd: options.cwd
        })
      ]);
      const files = mergeDiffSummaryRows({
        numstat: numstat.stdout,
        nameStatus: nameStatus.stdout
      });
      const truncated = files.length > maxFiles;
      const value = {
        commands: {
          numstat: numstatCommand,
          nameStatus: nameStatusCommand,
          shortstat: shortstatCommand
        },
        exitCode: firstNonZeroExitCode([numstat, nameStatus, shortstat]),
        files: files.slice(0, maxFiles),
        totals: diffSummaryTotals(files),
        shortstat: shortstat.stdout.trim(),
        truncated,
        maxFiles
      };

      return {
        value,
        output: {
          files: value.files.length,
          truncated,
          additions: value.totals.additions,
          deletions: value.totals.deletions,
          shortstat: value.shortstat
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedGitLog(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    range?: string;
    path?: string;
    maxCommits?: number;
  }
) {
  const maxCommits = Math.min(options.maxCommits ?? 20, 100);
  const command = gitLogCommand({
    range: options.range,
    path: options.path,
    maxCommits
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.log",
    command,
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      commits: parseGitLogOutput(result.stdout),
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
}

export async function runGovernedGitShow(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    ref: string;
    path?: string;
    maxBytes?: number;
  }
) {
  const command = gitShowCommand({
    ref: options.ref,
    path: options.path
  });

  return runGovernedGitCommand({
    ...options,
    actionType: "git.show",
    command,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    output: (result) => ({
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    })
  });
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

export async function runGovernedFileInfo(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxEntries?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.stat",
      path: options.path,
      stableParts: [options.cwd, options.path, options.maxEntries]
    }),
    run: async () => {
      const value = await inspectWorkspacePath(options.cwd, {
        path: options.path,
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries })
      });

      return {
        value,
        output: {
          path: value.path,
          type: value.type,
          bytes: value.bytes,
          ...(value.directory === undefined
            ? {}
            : {
                entries: value.directory.entries.length,
                truncated: value.directory.truncated
              })
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedTree(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    path: string;
    maxDepth?: number;
    maxEntries?: number;
    includeFiles: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: options.path,
      stableParts: [
        options.cwd,
        options.path,
        options.maxDepth,
        options.maxEntries,
        options.includeFiles
      ]
    }),
    run: async () => {
      const value = await workspaceTree(options.cwd, {
        path: options.path,
        ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
        ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
        includeFiles: options.includeFiles
      });

      return {
        value,
        output: {
          path: value.path,
          entries: value.entries.length,
          truncated: value.truncated,
          maxDepth: value.maxDepth
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedReadManyFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    paths: string[];
    maxBytesPerFile?: number;
    maxTotalBytes?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.read",
      path: ".",
      filesTouched: options.paths,
      stableParts: [
        options.cwd,
        options.paths,
        options.maxBytesPerFile,
        options.maxTotalBytes
      ]
    }),
    run: async () => {
      const value = await readManyWorkspaceFiles(options.cwd, {
        paths: options.paths,
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile }),
        ...(options.maxTotalBytes === undefined
          ? {}
          : { maxTotalBytes: options.maxTotalBytes })
      });

      return {
        value,
        output: {
          files: value.files.length,
          errors: value.errors.length,
          bytes: value.bytes,
          returnedBytes: value.returnedBytes,
          truncated: value.truncated
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedSearchText(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    query: string;
    regex: boolean;
    glob?: string[];
    caseSensitive: boolean;
    contextLines?: number;
    maxMatches?: number;
    maxBytesPerFile?: number;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.search",
      path: ".",
      stableParts: [
        options.cwd,
        options.query,
        options.regex,
        options.glob ?? [],
        options.caseSensitive,
        options.contextLines,
        options.maxMatches,
        options.maxBytesPerFile
      ]
    }),
    run: async () => {
      const value = await searchWorkspaceText(options.cwd, {
        query: options.query,
        regex: options.regex,
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        caseSensitive: options.caseSensitive,
        ...(options.contextLines === undefined
          ? {}
          : { contextLines: options.contextLines }),
        ...(options.maxMatches === undefined ? {} : { maxMatches: options.maxMatches }),
        ...(options.maxBytesPerFile === undefined
          ? {}
          : { maxBytesPerFile: options.maxBytesPerFile })
      });

      return {
        value,
        output: {
          matches: value.matches.length,
          truncated: value.truncated,
          filesSearched: value.filesSearched,
          filesTruncated: value.filesTruncated,
          filesSkippedTooLarge: value.filesSkippedTooLarge
        }
      };
    }
  }).then((result) => result.value);
}

export async function runGovernedListFiles(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    glob?: string[];
    exclude?: string[];
    maxResults?: number;
    includeDirs: boolean;
  }
) {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: filesystemReadAction({
      cwd: options.cwd,
      actionType: "filesystem.list",
      path: ".",
      stableParts: [
        options.cwd,
        options.glob ?? [],
        options.exclude ?? [],
        options.maxResults,
        options.includeDirs
      ]
    }),
    run: async () => {
      const value = await listWorkspaceFiles(options.cwd, {
        ...(options.glob === undefined ? {} : { glob: options.glob }),
        ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
        ...(options.maxResults === undefined ? {} : { maxResults: options.maxResults }),
        includeDirs: options.includeDirs
      });

      return {
        value,
        output: {
          entries: value.entries.length,
          truncated: value.truncated,
          maxResults: value.maxResults
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

export async function runGovernedGitRead(
  options: CodexDirectWorkerOptions & { workerRun: WorkerRun },
  command: string
): Promise<Pick<ShellCommandResult, "exitCode" | "stdout" | "stderr">> {
  return runGovernedToolAction({
    ...governedToolOptions(options),
    action: gitReadAction({
      cwd: options.cwd,
      actionType: command.startsWith("git diff") ? "git.diff" : "git.status"
    }),
    run: async () => {
      const value = await runShellCommand({
        command,
        cwd: options.cwd
      });

      return {
        value: {
          exitCode: value.exitCode,
          stdout: value.stdout,
          stderr: value.stderr
        },
        output: shellCommandOutput(value)
      };
    }
  }).then((result) => result.value);
}

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
