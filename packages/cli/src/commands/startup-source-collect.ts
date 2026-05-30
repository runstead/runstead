import { requireRbacPermission } from "../cli-rbac.js";
import { parsePositiveInteger } from "../startup-command-parsers.js";
import { resolveStartupSourceCollectSource } from "../startup-source-provider-shortcuts.js";

export interface StartupSourceCollectCommandOptions {
  cwd?: string;
  connector?: string;
  sourceUri?: string;
  githubRepo?: string;
  githubRunId?: string;
  vercelDeployment?: string;
  vercelTeam?: string;
  sentryOrg?: string;
  sentryRelease?: string;
  sentryProjectId?: string;
  posthogEnvironment?: string;
  posthogProject?: string;
  posthogInsight?: string;
  posthogHost?: string;
  target?: string;
  token?: string;
  capturedAt?: string;
  freshnessDays?: string;
  sourceHash?: string;
  trust?: string;
  goal?: string;
  actor: string;
}

export async function collectStartupSourceCommand(
  options: StartupSourceCollectCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "collect startup source evidence"
  });

  const { collectStartupSourceEvidence } =
    await import("../startup-source-connectors.js");
  const source = resolveStartupSourceCollectSource(options);
  const result = await collectStartupSourceEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    connector: source.connector,
    uri: source.sourceUri,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
    ...(options.freshnessDays === undefined
      ? {}
      : {
          freshnessDays: parsePositiveInteger(options.freshnessDays, "--freshness-days")
        }),
    ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
    ...(options.trust === undefined ? {} : { trustLevel: options.trust }),
    ...(options.goal === undefined ? {} : { goalId: options.goal })
  });

  console.log(`Collected source evidence: ${result.evidence.id}`);
  console.log(`Connector: ${result.connector}`);
  if (source.shortcut !== undefined) {
    console.log(`Shortcut: ${source.shortcut}`);
  }
  console.log(`Adapter: ${result.adapter.provider}`);
  console.log(`Collection: ${result.collection.status}`);
  console.log(`Evidence type: startup_${result.evidenceType}`);
  console.log(`Artifact: ${result.artifactPath}`);
}
