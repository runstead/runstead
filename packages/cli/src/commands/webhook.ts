import type { Command } from "commander";

import {
  collectValues,
  parseCiRepairWorkerKind,
  parseRequiredInteger
} from "../cli-parsers.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { parseVerifierCommandOption } from "../verifier-command-options.js";

export function registerWebhookCommand(program: Command): Command {
  const webhook = program
    .command("webhook")
    .description("Run webhook receivers. Experimental.");

  webhook
    .command("serve")
    .description("Serve the GitHub webhook endpoint.")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <number>", "Port to bind", "8787")
    .option("--cwd <path>", "Workspace directory")
    .option("--secret <secret>", "GitHub webhook secret")
    .option("--allow-unsigned", "Allow unsigned webhook requests")
    .option("--github-app", "Use configured GitHub App installation auth")
    .option("--installation-id <id>", "Override configured GitHub App installation id")
    .option(
      "--orchestrate-repair",
      "Run the governed CI repair loop for repairable workflow_run events"
    )
    .option(
      "--worker <worker>",
      "Worker to run when orchestrating repairs",
      "codex_cli"
    )
    .option("--provider <provider>", "Model provider to use with codex_direct")
    .option(
      "--model <model>",
      "Model to use with codex_direct, codex_cli, or claude_code"
    )
    .option("--base-url <url>", "Model provider base URL")
    .option("--base <ref>", "PR base branch when orchestrating repairs")
    .option("--draft", "Create draft pull requests when orchestrating repairs")
    .option(
      "--allowed <pattern>",
      "Allowed changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--denied <pattern>",
      "Denied changed path pattern when orchestrating repairs",
      collectValues,
      []
    )
    .option(
      "--verifier <name=command>",
      "Verifier command for orchestrated repairs",
      collectValues,
      []
    )
    .option("--actor <id>", "RBAC subject for webhook management", "local-admin")
    .action(
      async (options: {
        host: string;
        port: string;
        cwd?: string;
        secret?: string;
        allowUnsigned?: boolean;
        githubApp?: boolean;
        installationId?: string;
        orchestrateRepair?: boolean;
        worker: string;
        provider?: string;
        model?: string;
        baseUrl?: string;
        base?: string;
        draft?: boolean;
        allowed: string[];
        denied: string[];
        verifier: string[];
        actor: string;
      }) => {
        const { checkPermission } = await import("../rbac.js");
        const permission = await checkPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          subject: options.actor,
          permission: "webhook.manage"
        });

        if (permission.decision !== "allow") {
          throw new Error(
            `Subject ${options.actor} cannot manage webhooks: ${permission.reason}`
          );
        }

        if (options.secret === undefined && options.allowUnsigned !== true) {
          throw new Error(
            "GitHub webhook secret is required unless --allow-unsigned is set"
          );
        }

        const verifierCommands = options.verifier.map(parseVerifierCommandOption);

        if (options.orchestrateRepair === true && verifierCommands.length === 0) {
          throw new Error("--verifier is required when --orchestrate-repair is set");
        }

        const { createWebhookServer } = await import("../webhook-server.js");
        const { repairableWorkflowRunIdFromWebhook } = await import("../ci-repair.js");
        const { handleGitHubWorkflowRunWebhook, recordGitHubWorkflowRunWebhookEvent } =
          await import("../webhook-workflow-run.js");
        const port = parseRequiredInteger(options.port, "--port");
        const server = createWebhookServer({
          ...(options.secret === undefined ? {} : { secret: options.secret }),
          ...(options.allowUnsigned === undefined
            ? {}
            : { allowUnsigned: options.allowUnsigned }),
          handler: async (event) => {
            const runId = repairableWorkflowRunIdFromWebhook(
              event.event,
              event.payload
            );
            const authToken =
              runId === undefined ? undefined : await resolveGitHubAuthToken(options);

            await handleGitHubWorkflowRunWebhook({
              event: event.event,
              delivery: event.delivery,
              payload: event.payload,
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              ...(authToken === undefined ? {} : { authToken }),
              mode: options.orchestrateRepair === true ? "orchestrate" : "intake",
              dedupeDelivery: true,
              worker: parseCiRepairWorkerKind(options.worker),
              ...(options.provider === undefined ? {} : { provider: options.provider }),
              ...(options.model === undefined ? {} : { model: options.model }),
              ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
              ...(options.base === undefined ? {} : { base: options.base }),
              draft: options.draft === true,
              allowedPaths: options.allowed,
              deniedPaths: options.denied,
              verifierCommands,
              audit: recordGitHubWorkflowRunWebhookEvent
            });
          }
        });

        server.listen(port, options.host, () => {
          console.log(`Runstead webhook server listening on ${options.host}:${port}`);
          console.log("GitHub endpoint: /webhooks/github");
        });
      }
    );

  return webhook;
}
