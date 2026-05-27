import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { requireUnmanagedHelperAcknowledgement } from "../cli-unmanaged.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { addGitHubAppCommands } from "./github-app.js";
import { registerGitHubRunCommand } from "./github-run.js";

export function registerGitHubCommand(program: Command): Command {
  const github = program.command("github").description("GitHub integration.");
  addGitHubAppCommands(github);
  registerGitHubRunCommand(github);

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
