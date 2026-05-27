import { requireRbacPermission } from "../cli-rbac.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { parseVerifierCommandOption } from "../verifier-command-options.js";

export interface GitHubRunAuthCommandOptions {
  cwd?: string;
  githubApp?: boolean;
  installationId?: string;
  actor: string;
}

export interface GitHubRunRepairCommandOptions extends GitHubRunAuthCommandOptions {
  verifier: string[];
}

export async function runGitHubRunStatusCommand(
  runId: string,
  options: GitHubRunAuthCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.read",
    action: "inspect GitHub workflow runs"
  });

  const authToken = await resolveGitHubAuthToken(options);
  const { formatWorkflowRunStatus, getGitHubWorkflowRunStatus } =
    await import("../github-actions.js");
  const result = await getGitHubWorkflowRunStatus({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    ...(authToken === undefined ? {} : { authToken })
  });

  console.log(formatWorkflowRunStatus(result));
}

export async function runGitHubRunLogsCommand(
  runId: string,
  options: GitHubRunAuthCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "repo.read",
    action: "inspect GitHub workflow run logs"
  });

  const authToken = await resolveGitHubAuthToken(options);
  const { fetchGitHubWorkflowRunLog } = await import("../github-actions.js");
  const result = await fetchGitHubWorkflowRunLog({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    ...(authToken === undefined ? {} : { authToken })
  });

  process.stdout.write(result.log);
}

export async function runGitHubRunRepairCommand(
  runId: string,
  options: GitHubRunRepairCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "create CI repair tasks"
  });

  const authToken = await resolveGitHubAuthToken(options);
  const { createCiRepairTaskFromWorkflowRun, formatCiRepairTaskReport } =
    await import("../ci-repair.js");
  const result = await createCiRepairTaskFromWorkflowRun({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    ...(authToken === undefined ? {} : { authToken }),
    verifierCommands: options.verifier.map(parseVerifierCommandOption)
  });

  console.log(formatCiRepairTaskReport(result));
}
