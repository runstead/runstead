import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { requireUnmanagedHelperAcknowledgement } from "../cli-unmanaged.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { parseVerifierCommandOption } from "../verifier-command-options.js";
import { addCiRepairOrchestrationCommand } from "./ci-repair.js";
import { addGitHubAppCommands } from "./github-app.js";

export function registerGitHubCommand(program: Command): Command {
  const github = program.command("github").description("GitHub integration.");
  addGitHubAppCommands(github);
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

  const githubPr = github.command("pr").description("Create GitHub pull requests.");

  githubPr
    .command("create")
    .description(
      "Create a GitHub pull request with Runstead evidence. Unmanaged helper; governed PR creation runs through CI repair."
    )
    .requiredOption("--title <title>", "Pull request title")
    .requiredOption("--base <ref>", "Base branch")
    .requiredOption("--head <ref>", "Head branch")
    .option("--cwd <path>", "Workspace directory")
    .option("--body <body>", "Pull request body")
    .option("--draft", "Create a draft pull request")
    .option("--task <id>", "Runstead task id")
    .option("--goal <id>", "Runstead goal id")
    .option("--evidence <summary>", "Evidence summary", collectValues, [])
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for pull request creation", "local-admin")
    .option("--unmanaged", "Acknowledge this helper bypasses governed runtime")
    .action(
      async (commandOptions: {
        cwd?: string;
        title: string;
        base: string;
        head: string;
        body?: string;
        draft?: boolean;
        task?: string;
        goal?: string;
        evidence: string[];
        githubApp?: boolean;
        installationId?: string;
        actor: string;
        unmanaged?: boolean;
      }) => {
        requireUnmanagedHelperAcknowledgement(
          commandOptions,
          "create GitHub pull requests"
        );
        await requireRbacPermission({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          actor: commandOptions.actor,
          permission: "repo.manage",
          action: "create GitHub pull requests"
        });

        const authToken = await resolveGitHubAuthToken(commandOptions);
        const { createGitHubPullRequest } = await import("../github-pr.js");
        const result = await createGitHubPullRequest({
          ...(commandOptions.cwd === undefined ? {} : { cwd: commandOptions.cwd }),
          title: commandOptions.title,
          base: commandOptions.base,
          head: commandOptions.head,
          ...(commandOptions.body === undefined ? {} : { body: commandOptions.body }),
          ...(commandOptions.draft === undefined
            ? {}
            : { draft: commandOptions.draft }),
          ...(commandOptions.task === undefined ? {} : { taskId: commandOptions.task }),
          ...(commandOptions.goal === undefined ? {} : { goalId: commandOptions.goal }),
          ...(authToken === undefined ? {} : { authToken }),
          evidence: evidenceSummariesFromCli(commandOptions.evidence)
        });

        console.log(`Created PR: ${result.url ?? result.stdout.trim()}`);
      }
    );

  return github;
}

function evidenceSummariesFromCli(values: string[]) {
  return values.map((summary, index) => ({
    id: `cli_evidence_${index + 1}`,
    type: "manual",
    summary
  }));
}
