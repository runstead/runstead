import { requireRbacPermission } from "../cli-rbac.js";

export interface RepoAddCommandOptions {
  cwd?: string;
  alias?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  tags?: string;
  actor: string;
}

export interface RepoListCommandOptions {
  cwd?: string;
  status?: string;
  actor: string;
}

export interface RepoShowCommandOptions {
  cwd?: string;
  actor: string;
}

export interface RepoArchiveCommandOptions {
  cwd?: string;
  actor: string;
}

export async function runRepoAddCommand(
  path: string | undefined,
  options: RepoAddCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.manage",
    action: "manage repositories"
  });

  const { registerRepository } = await import("../repositories.js");
  const result = await registerRepository({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(path === undefined ? {} : { path }),
    ...(options.alias === undefined ? {} : { alias: options.alias }),
    ...(options.remoteUrl === undefined ? {} : { remoteUrl: options.remoteUrl }),
    ...(options.defaultBranch === undefined
      ? {}
      : { defaultBranch: options.defaultBranch }),
    ...(options.tags === undefined
      ? {}
      : { tags: parseCommaSeparatedList(options.tags) })
  });

  console.log(
    `${result.created ? "Registered" : "Updated"} repository: ${result.repository.alias}`
  );
  console.log(`ID: ${result.repository.id}`);
  console.log(`Path: ${result.repository.localPath}`);
}

export async function runRepoListCommand(
  options: RepoListCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.read",
    action: "list repositories"
  });

  const { listRepositories } = await import("../repositories.js");
  const status = parseRepositoryStatus(options.status);
  const result = listRepositories({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(status === undefined ? {} : { status })
  });

  if (result.repositories.length === 0) {
    console.log("No repositories found.");
    return;
  }

  for (const item of result.repositories) {
    console.log(`${item.status.padEnd(8)} ${item.id} ${item.alias} ${item.localPath}`);
  }
}

export async function runRepoShowCommand(
  ref: string,
  options: RepoShowCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.read",
    action: "inspect repositories"
  });

  const { showRepository } = await import("../repositories.js");
  const result = showRepository({ ...options, ref });

  console.log(`Repository: ${result.repository.id}`);
  console.log(`Alias: ${result.repository.alias}`);
  console.log(`Status: ${result.repository.status}`);
  console.log(`Path: ${result.repository.localPath}`);
  console.log(`Remote: ${result.repository.remoteUrl ?? "none"}`);
  console.log(`Default branch: ${result.repository.defaultBranch ?? "unknown"}`);
  console.log(`Tags: ${result.repository.tags.join(", ") || "none"}`);
}

export async function runRepoArchiveCommand(
  ref: string,
  options: RepoArchiveCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.manage",
    action: "manage repositories"
  });

  const { archiveRepository } = await import("../repositories.js");
  const result = archiveRepository({ ...options, ref });

  console.log(`Archived repository: ${result.repository.alias}`);
  console.log(`Previous status: ${result.previousStatus}`);
  console.log(`Path: ${result.repository.localPath}`);
}

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRepositoryStatus(
  value: string | undefined
): "active" | "archived" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "active" || value === "archived") {
    return value;
  }

  throw new Error("--status must be active or archived");
}
