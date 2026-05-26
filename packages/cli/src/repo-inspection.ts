import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_REPO_INSPECTION_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_REPO_INSPECTION_GIT_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface GitInspection {
  isGitRepo: boolean;
  root?: string;
  branch?: string;
  headSha?: string;
}

export interface InspectGitRepositoryOptions {
  gitTimeoutMs?: number;
  gitMaxOutputBytes?: number;
}

export {
  inspectBuildCommand,
  inspectLintCommand,
  inspectPackageManager,
  inspectTestCommand,
  inspectTypecheckCommand
} from "./repo-inspection-package.js";
export type {
  PackageManager,
  PackageManagerInspection,
  PackageManagerSource,
  PackageScriptCommandInspection
} from "./repo-inspection-package.js";
export { inspectCiProvider } from "./repo-inspection-ci.js";
export type {
  CiProvider,
  CiProviderInspection,
  CiProviderMatch
} from "./repo-inspection-ci.js";

export async function inspectGitRepository(
  cwd = process.cwd(),
  options: InspectGitRepositoryOptions = {}
): Promise<GitInspection> {
  const workspace = resolve(cwd);
  const gitOptions = {
    maxOutputBytes:
      options.gitMaxOutputBytes ?? DEFAULT_REPO_INSPECTION_GIT_MAX_OUTPUT_BYTES,
    timeoutMs: options.gitTimeoutMs ?? DEFAULT_REPO_INSPECTION_GIT_TIMEOUT_MS
  };
  const root = await runGit(["rev-parse", "--show-toplevel"], workspace, gitOptions);

  if (!root.ok) {
    return {
      isGitRepo: false
    };
  }

  const branch = await runGit(["branch", "--show-current"], workspace, gitOptions);
  const headSha = await runGit(
    ["rev-parse", "--verify", "HEAD"],
    workspace,
    gitOptions
  );
  const inspection: GitInspection = {
    isGitRepo: true,
    root: await realpath(root.stdout)
  };

  if (branch.ok && branch.stdout.length > 0) {
    inspection.branch = branch.stdout;
  }

  if (headSha.ok && headSha.stdout.length > 0) {
    inspection.headSha = headSha.stdout;
  }

  return inspection;
}

interface GitCommandResult {
  ok: boolean;
  stdout: string;
}

async function runGit(
  args: string[],
  cwd: string,
  options: { maxOutputBytes: number; timeoutMs: number }
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: options.maxOutputBytes,
      timeout: options.timeoutMs,
      windowsHide: true
    });

    return {
      ok: true,
      stdout: result.stdout.trim()
    };
  } catch {
    return {
      ok: false,
      stdout: ""
    };
  }
}
