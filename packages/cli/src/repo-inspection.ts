import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitInspection {
  isGitRepo: boolean;
  root?: string;
  branch?: string;
  headSha?: string;
}

export async function inspectGitRepository(
  cwd = process.cwd()
): Promise<GitInspection> {
  const workspace = resolve(cwd);
  const root = await runGit(["rev-parse", "--show-toplevel"], workspace);

  if (!root.ok) {
    return {
      isGitRepo: false
    };
  }

  const branch = await runGit(["branch", "--show-current"], workspace);
  const headSha = await runGit(["rev-parse", "--verify", "HEAD"], workspace);
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

async function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
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
