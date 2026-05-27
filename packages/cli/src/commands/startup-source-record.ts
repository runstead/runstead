import { requireRbacPermission } from "../cli-rbac.js";
import { parsePositiveInteger } from "../startup-command-parsers.js";

export interface StartupSourceRecordCommandOptions {
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
}

export async function recordStartupSourceCommand(
  options: StartupSourceRecordCommandOptions
): Promise<void> {
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
    ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
    ...(options.freshnessDays === undefined
      ? {}
      : {
          freshnessDays: parsePositiveInteger(options.freshnessDays, "--freshness-days")
        }),
    ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
    trustLevel: options.trust,
    ...(options.payload === undefined ? {} : { payload: options.payload }),
    ...(options.goal === undefined ? {} : { goalId: options.goal })
  });

  console.log(`Recorded source evidence: ${result.evidence.id}`);
  console.log(`Connector: ${result.connector}`);
  console.log(`Evidence type: startup_${result.evidenceType}`);
  console.log(`Artifact: ${result.artifactPath}`);
}
