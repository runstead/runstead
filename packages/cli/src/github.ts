import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  remoteUrl: string;
}

export interface GitHubRepositoryInspection {
  detected: boolean;
  cwd: string;
  remote: string;
  repository?: GitHubRepositoryRef;
  remoteUrl?: string;
}

export interface InspectGitHubRepositoryOptions {
  cwd?: string;
  remote?: string;
}

export async function inspectGitHubRepository(
  options: InspectGitHubRepositoryOptions = {}
): Promise<GitHubRepositoryInspection> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const remote = options.remote ?? "origin";
  const remoteUrl = await readGitRemoteUrl(cwd, remote);

  if (remoteUrl === undefined) {
    return {
      detected: false,
      cwd,
      remote
    };
  }

  const repository = parseGitHubRemoteUrl(remoteUrl);

  return {
    detected: repository !== undefined,
    cwd,
    remote,
    remoteUrl,
    ...(repository === undefined ? {} : { repository })
  };
}

export function parseGitHubRemoteUrl(
  remoteUrl: string
): GitHubRepositoryRef | undefined {
  const trimmed = remoteUrl.trim();
  const urlRef = parseGitHubUrl(trimmed) ?? parseGitHubSshShorthand(trimmed);

  if (urlRef === undefined) {
    return undefined;
  }

  return {
    ...urlRef,
    remoteUrl: trimmed
  };
}

async function readGitRemoteUrl(
  cwd: string,
  remote: string
): Promise<string | undefined> {
  try {
    const result = await execFileAsync(
      "git",
      ["config", "--get", `remote.${remote}.url`],
      {
        cwd,
        windowsHide: true
      }
    );
    const stdout = result.stdout.trim();

    return stdout.length === 0 ? undefined : stdout;
  } catch {
    return undefined;
  }
}

function parseGitHubUrl(
  remoteUrl: string
): Omit<GitHubRepositoryRef, "remoteUrl"> | undefined {
  try {
    const parsed = new URL(remoteUrl);

    if (parsed.hostname !== "github.com") {
      return undefined;
    }

    return repositoryRefFromPath(parsed.pathname);
  } catch {
    return undefined;
  }
}

function parseGitHubSshShorthand(
  remoteUrl: string
): Omit<GitHubRepositoryRef, "remoteUrl"> | undefined {
  const match = /^(?:git@)?github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+)$/.exec(
    remoteUrl
  );

  const owner = match?.groups?.owner;
  const repo = match?.groups?.repo;

  if (owner === undefined || repo === undefined) {
    return undefined;
  }

  return repositoryRefFromParts(owner, repo);
}

function repositoryRefFromPath(
  path: string
): Omit<GitHubRepositoryRef, "remoteUrl"> | undefined {
  const [owner, repo] = path.replace(/^\/+/, "").split("/");

  if (owner === undefined || repo === undefined) {
    return undefined;
  }

  return repositoryRefFromParts(owner, repo);
}

function repositoryRefFromParts(
  owner: string,
  repo: string
): Omit<GitHubRepositoryRef, "remoteUrl"> | undefined {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

  if (normalizedOwner.length === 0 || normalizedRepo.length === 0) {
    return undefined;
  }

  return {
    owner: normalizedOwner,
    repo: normalizedRepo
  };
}
