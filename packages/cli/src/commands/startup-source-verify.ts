import { requireRbacPermission } from "../cli-rbac.js";
import { parsePositiveInteger } from "../startup-command-parsers.js";

export interface StartupSourceVerifyCommandOptions {
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
}

export async function verifyStartupSourceCommand(
  options: StartupSourceVerifyCommandOptions
): Promise<void> {
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

  console.log(`Verified source evidence: ${result.evidence.id}`);
  console.log(`Connector: ${result.connector}`);
  console.log(
    `Verification: ${result.verification.status} http=${result.verification.statusCode} expected=${result.verification.expectedStatus}`
  );
  console.log(`Evidence type: startup_${result.evidenceType}`);
  console.log(`Artifact: ${result.artifactPath}`);
}
