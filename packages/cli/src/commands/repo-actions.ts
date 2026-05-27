import { requireRbacPermission } from "../cli-rbac.js";

export { runRepoListCommand, runRepoShowCommand } from "./repo-read-actions.js";
export type {
  RepoListCommandOptions,
  RepoShowCommandOptions
} from "./repo-read-actions.js";

export interface RepoAddCommandOptions {
  cwd?: string;
  alias?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  tags?: string;
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
