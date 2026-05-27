import { requireRbacPermission } from "../cli-rbac.js";

export interface RepoListCommandOptions {
  cwd?: string;
  status?: string;
  actor: string;
}

export interface RepoShowCommandOptions {
  cwd?: string;
  actor: string;
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

export function parseRepositoryStatus(
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
