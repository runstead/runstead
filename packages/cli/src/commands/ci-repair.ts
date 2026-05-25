import type { Command } from "commander";

import { collectValues, parseCiRepairWorkerKind } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { requireVerifierCommandOptions } from "../verifier-command-options.js";

interface CiRepairOrchestrationCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  base?: string;
  draft?: boolean;
  allowed: string[];
  denied: string[];
  githubApp?: boolean;
  installationId?: string;
  verifier: string[];
  actor: string;
}

export function registerCiRepairCommand(program: Command): Command {
  const command = program
    .command("repair-ci")
    .description("Run the governed CI repair branch, worker, verifier, and PR loop.");

  addCiRepairOrchestrationCommand(command);

  return command;
}

export function addCiRepairOrchestrationCommand(command: Command): void {
  command
    .argument("<run-id>", "GitHub Actions workflow run id")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--worker <worker>",
      "Worker to run: codex_cli, claude_code, or codex_direct",
      "codex_cli"
    )
    .option(
      "--model <model>",
      "Model to use with codex_direct, codex_cli, or claude_code"
    )
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option("--base-url <url>", "Model provider base URL")
    .option("--base <ref>", "PR base branch")
    .option("--draft", "Create a draft pull request")
    .option("--allowed <pattern>", "Allowed changed path pattern", collectValues, [])
    .option("--denied <pattern>", "Denied changed path pattern", collectValues, [])
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option("--actor <id>", "RBAC subject for repair orchestration", "local-admin")
    .option(
      "--verifier <name=command>",
      "Verifier command to run after repair",
      collectValues,
      []
    )
    .action(async (runId: string, options: CiRepairOrchestrationCliOptions) => {
      await runCiRepairOrchestrationFromCli(runId, options);
    });
}

async function runCiRepairOrchestrationFromCli(
  runId: string,
  options: CiRepairOrchestrationCliOptions
): Promise<void> {
  const verifierCommands = requireVerifierCommandOptions(options.verifier, "repair-ci");

  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "orchestrate CI repair"
  });

  const authToken = await resolveGitHubAuthToken(options);
  const { formatCiRepairOrchestratorReport, runCiRepairOrchestrator } =
    await import("../ci-repair-orchestrator.js");
  const result = await runCiRepairOrchestrator({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    runId,
    worker: parseCiRepairWorkerKind(options.worker),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.base === undefined ? {} : { base: options.base }),
    draft: options.draft === true,
    allowedPaths: options.allowed,
    deniedPaths: options.denied,
    ...(authToken === undefined ? {} : { authToken }),
    verifierCommands
  });

  console.log(formatCiRepairOrchestratorReport(result));
}
