import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandVerifierCodeState {
  kind: "git_workspace";
  available: boolean;
  headState: "committed" | "unborn" | "unknown";
  gitHead?: string;
  dirty: boolean;
  statusHash: string;
  fileSetHash: string;
  fingerprint: string;
  changedFiles: CommandVerifierChangedFile[];
}

export interface CommandVerifierChangedFile {
  path: string;
  status: string;
  hash?: string;
}

export async function collectCommandVerifierCodeState(
  cwd: string
): Promise<CommandVerifierCodeState> {
  const insideWorkTree = await gitOutput(cwd, ["rev-parse", "--is-inside-work-tree"]);
  const gitHead = await gitOutput(cwd, ["rev-parse", "--verify", "HEAD"]);
  const statusOutput = await gitOutput(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);

  if (insideWorkTree?.trim() !== "true" || statusOutput === undefined) {
    const fallback = sha256(`nogit:${cwd}`);

    return {
      kind: "git_workspace",
      available: false,
      headState: "unknown",
      dirty: false,
      statusHash: fallback,
      fileSetHash: fallback,
      fingerprint: fallback,
      changedFiles: []
    };
  }

  const changedFiles = await Promise.all(
    parseGitPorcelainStatus(statusOutput)
      .filter((entry) => !isRunsteadInternalPath(entry.path))
      .map(async (entry) => ({
        ...entry,
        ...(await fileHash(cwd, entry.path))
      }))
  );
  const statusHash = sha256(statusOutput);
  const fileSetHash = sha256(JSON.stringify(changedFiles));
  const normalizedGitHead = gitHead?.trim();
  const headState = normalizedGitHead === undefined ? "unborn" : "committed";
  const fingerprint = sha256(
    JSON.stringify({
      gitHead: normalizedGitHead ?? "unborn",
      headState,
      statusHash,
      fileSetHash
    })
  );

  return {
    kind: "git_workspace",
    available: true,
    headState,
    ...(normalizedGitHead === undefined ? {} : { gitHead: normalizedGitHead }),
    dirty: changedFiles.length > 0,
    statusHash,
    fileSetHash,
    fingerprint,
    changedFiles
  };
}

async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    return stdout;
  } catch {
    return undefined;
  }
}

function parseGitPorcelainStatus(output: string): CommandVerifierChangedFile[] {
  return output
    .split("\0")
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const status = entry.slice(0, 2);
      const path = entry.slice(3);

      if (path.length === 0) {
        return [];
      }

      return [
        {
          status,
          path
        }
      ];
    });
}

function isRunsteadInternalPath(path: string): boolean {
  return path === ".runstead" || path.startsWith(".runstead/");
}

async function fileHash(cwd: string, relativePath: string): Promise<{ hash?: string }> {
  const absolutePath = resolve(cwd, relativePath);

  try {
    const fileStat = await stat(absolutePath);

    if (!fileStat.isFile()) {
      return {};
    }

    return {
      hash: sha256(await readFile(absolutePath))
    };
  } catch {
    return {};
  }
}

function sha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
