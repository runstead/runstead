import { requireRbacPermission } from "../cli-rbac.js";
import { parsePositiveInteger } from "../startup-command-parsers.js";

export interface StartupSourceCollectCommandOptions {
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
  const result = await collectStartupSourceEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    connector: options.connector,
    uri: options.sourceUri,
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
  console.log(`Adapter: ${result.adapter.provider}`);
  console.log(`Collection: ${result.collection.status}`);
  console.log(`Evidence type: startup_${result.evidenceType}`);
  console.log(`Artifact: ${result.artifactPath}`);
}
