import { parseCiRepairWorkerKind, parseRequiredInteger } from "../cli-parsers.js";
import { resolveGitHubAuthToken } from "../github-auth-token.js";
import { parseVerifierCommandOption } from "../verifier-command-options.js";

export interface WebhookServeCommandOptions {
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
}

export async function runWebhookServeCommand(
  options: WebhookServeCommandOptions
): Promise<void> {
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
    throw new Error("GitHub webhook secret is required unless --allow-unsigned is set");
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
      const runId = repairableWorkflowRunIdFromWebhook(event.event, event.payload);
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
