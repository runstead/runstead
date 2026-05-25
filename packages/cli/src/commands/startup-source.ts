import type { Command } from "commander";

import { checkPermission } from "../rbac.js";

export function registerStartupSourceCommand(startup: Command): Command {
  const startupSource = startup
    .command("source")
    .description("Ingest startup evidence from external source connectors.");

  startupSource
    .command("list")
    .description("List startup source connector contracts.")
    .action(async () => {
      const { getStartupSourceProviderAdapter, listStartupSourceConnectorDefinitions } =
        await import("../startup-source-connectors.js");

      for (const definition of listStartupSourceConnectorDefinitions()) {
        const adapter = getStartupSourceProviderAdapter(definition.connector);

        console.log(
          [
            definition.connector,
            `evidence=${definition.evidenceType}`,
            `source=${definition.sourceKind}`,
            `quality=${definition.qualityTier}`,
            `trust=${definition.defaultTrustLevel}`,
            `freshness=${definition.defaultFreshnessDays}d`,
            `adapter=${adapter?.provider ?? "none"}`,
            `payload=${definition.recommendedPayloadFields.join(",") || "none"}`
          ].join(" ")
        );
      }
    });

  addRecordCommand(startupSource);
  addVerifyCommand(startupSource);
  addCollectCommand(startupSource);

  return startupSource;
}

function addRecordCommand(startupSource: Command): void {
  startupSource
    .command("record")
    .description(
      "Record GitHub, deployment, analytics, support, billing, or security source evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Connector: github_actions, github_pr, github_issue, vercel, fly, render, deployment, sentry, observability, posthog, analytics, billing, support, dependency"
    )
    .requiredOption("--source-uri <uri>", "Canonical source URI")
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--status <status>", "Source status or outcome")
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option(
      "--trust <level>",
      "Source trust level: low, medium, high, authoritative",
      "medium"
    )
    .option("--payload <json>", "Connector-specific JSON object payload")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        connector: string;
        sourceUri: string;
        summary: string;
        status?: string;
        target?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        trust: string;
        payload?: string;
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup source evidence"
        });

        const { recordStartupSourceEvidence } =
          await import("../startup-source-connectors.js");
        const result = await recordStartupSourceEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          connector: options.connector,
          uri: options.sourceUri,
          summary: options.summary,
          ...(options.status === undefined ? {} : { status: options.status }),
          ...(options.target === undefined ? {} : { target: options.target }),
          ...(options.capturedAt === undefined
            ? {}
            : { capturedAt: options.capturedAt }),
          ...(options.freshnessDays === undefined
            ? {}
            : {
                freshnessDays: parsePositiveInteger(
                  options.freshnessDays,
                  "--freshness-days"
                )
              }),
          ...(options.sourceHash === undefined
            ? {}
            : { sourceHash: options.sourceHash }),
          trustLevel: options.trust,
          ...(options.payload === undefined ? {} : { payload: options.payload }),
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Recorded source evidence: ${result.evidence.id}`);
        console.log(`Connector: ${result.connector}`);
        console.log(`Evidence type: startup_${result.evidenceType}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );
}

function addVerifyCommand(startupSource: Command): void {
  startupSource
    .command("verify")
    .description(
      "Verify a live GitHub, deployment, analytics, support, billing, or security source before recording evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Connector: github_actions, github_pr, github_issue, vercel, fly, render, deployment, sentry, observability, posthog, analytics, billing, support, dependency"
    )
    .requiredOption("--source-uri <uri>", "Canonical source URI to verify")
    .option("--summary <text>", "Evidence summary")
    .option("--method <method>", "HTTP method to use for verification", "GET")
    .option("--expect-status <status>", "Expected HTTP status", "200")
    .option(
      "--expect-text <text>",
      "Response text that must be present; repeat for multiple checks",
      collectValues,
      []
    )
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--trust <level>", "Source trust level: low, medium, high, authoritative")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        connector: string;
        sourceUri: string;
        summary?: string;
        method: string;
        expectStatus: string;
        expectText: string[];
        target?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        trust?: string;
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "verify startup source evidence"
        });

        const { verifyStartupSourceEvidence } =
          await import("../startup-source-connectors.js");
        const result = await verifyStartupSourceEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          connector: options.connector,
          uri: options.sourceUri,
          ...(options.summary === undefined ? {} : { summary: options.summary }),
          method: options.method,
          expectStatus: parsePositiveInteger(options.expectStatus, "--expect-status"),
          expectText: options.expectText,
          ...(options.target === undefined ? {} : { target: options.target }),
          ...(options.capturedAt === undefined
            ? {}
            : { capturedAt: options.capturedAt }),
          ...(options.freshnessDays === undefined
            ? {}
            : {
                freshnessDays: parsePositiveInteger(
                  options.freshnessDays,
                  "--freshness-days"
                )
              }),
          ...(options.sourceHash === undefined
            ? {}
            : { sourceHash: options.sourceHash }),
          ...(options.trust === undefined ? {} : { trustLevel: options.trust }),
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Verified source evidence: ${result.evidence.id}`);
        console.log(`Connector: ${result.connector}`);
        console.log(
          `Verification: ${result.verification.status} http=${result.verification.statusCode} expected=${result.verification.expectedStatus}`
        );
        console.log(`Evidence type: startup_${result.evidenceType}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );
}

function addCollectCommand(startupSource: Command): void {
  startupSource
    .command("collect")
    .description(
      "Collect structured evidence from an executable provider adapter before recording it."
    )
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--connector <kind>",
      "Executable connector: github_actions, vercel, render, sentry, or posthog"
    )
    .requiredOption("--source-uri <uri>", "Provider API URI to collect")
    .option(
      "--target <target>",
      "Readiness target this source supports: local, staging, or production"
    )
    .option("--token <token>", "Provider token; defaults to connector-specific env var")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--trust <level>", "Source trust level: low, medium, high, authoritative")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for source evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        connector: string;
        sourceUri: string;
        target?: string;
        token?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        trust?: string;
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "collect startup source evidence"
        });

        const { collectStartupSourceEvidence } =
          await import("../startup-source-connectors.js");
        const result = await collectStartupSourceEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          connector: options.connector,
          uri: options.sourceUri,
          ...(options.target === undefined ? {} : { target: options.target }),
          ...(options.token === undefined ? {} : { token: options.token }),
          ...(options.capturedAt === undefined
            ? {}
            : { capturedAt: options.capturedAt }),
          ...(options.freshnessDays === undefined
            ? {}
            : {
                freshnessDays: parsePositiveInteger(
                  options.freshnessDays,
                  "--freshness-days"
                )
              }),
          ...(options.sourceHash === undefined
            ? {}
            : { sourceHash: options.sourceHash }),
          ...(options.trust === undefined ? {} : { trustLevel: options.trust }),
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Collected source evidence: ${result.evidence.id}`);
        console.log(`Connector: ${result.connector}`);
        console.log(`Adapter: ${result.adapter.provider}`);
        console.log(`Collection: ${result.collection.status}`);
        console.log(`Evidence type: startup_${result.evidenceType}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

async function requireRbacPermission(options: {
  cwd?: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const result = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: options.permission
  });

  if (result.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot ${options.action}: ${result.reason}`
    );
  }
}
