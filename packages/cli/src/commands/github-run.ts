import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { parseVerifierCommandOption } from "../verifier-command-options.js";
import { addCiRepairOrchestrationCommand } from "./ci-repair.js";

export function registerGitHubRunCommand(github: Command): Command {
  const githubRun = github.command("run").description("Inspect GitHub workflow runs.");

  githubRun
    .command("status")
    .description(
      "Show GitHub workflow run status. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action(
      async (
        runId: string,
        commandOptions: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          actor: commandOptions.actor,
          permission: "repo.read",
          action: "inspect GitHub workflow runs"
        });

        const authToken = await resolveGitHubAuthToken(commandOptions);
        const { formatWorkflowRunStatus, getGitHubWorkflowRunStatus } =
          await import("../github-actions.js");
        const result = await getGitHubWorkflowRunStatus({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken })
        });

        console.log(formatWorkflowRunStatus(result));
      }
    );

  githubRun
    .command("logs")
    .description(
      "Print GitHub workflow run logs. Unmanaged helper; governed reads run through CI repair intake."
    )
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for GitHub run access", "local-admin")
    .action(
      async (
        runId: string,
        commandOptions: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
        }
      ) => {
        await requireRbacPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          actor: commandOptions.actor,
          permission: "repo.read",
          action: "inspect GitHub workflow run logs"
        });

        const authToken = await resolveGitHubAuthToken(commandOptions);
        const { fetchGitHubWorkflowRunLog } = await import("../github-actions.js");
        const result = await fetchGitHubWorkflowRunLog({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken })
        });

        process.stdout.write(result.log);
      }
    );

  githubRun
    .command("repair")
    .description("Create a CI repair task from a failed GitHub workflow run.")
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for repair task creation", "local-admin")
    .option(
      "--verifier <name=command>",
      "Verifier command to store on the CI repair task",
      collectValues,
      []
    )
    .action(
      async (
        runId: string,
        commandOptions: {
          cwd?: string;
          githubApp?: boolean;
          installationId?: string;
          actor: string;
          verifier: string[];
        }
      ) => {
        await requireRbacPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          actor: commandOptions.actor,
          permission: "task.run",
          action: "create CI repair tasks"
        });

        const authToken = await resolveGitHubAuthToken(commandOptions);
        const { createCiRepairTaskFromWorkflowRun, formatCiRepairTaskReport } =
          await import("../ci-repair.js");
        const result = await createCiRepairTaskFromWorkflowRun({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          runId,
          ...(authToken === undefined ? {} : { authToken }),
          verifierCommands: commandOptions.verifier.map(parseVerifierCommandOption)
        });

        console.log(formatCiRepairTaskReport(result));
      }
    );

  addCiRepairOrchestrationCommand(
    githubRun
      .command("orchestrate-repair")
      .description("Run the CI repair branch, worker, verifier, and PR loop.")
  );

  return githubRun;
}
