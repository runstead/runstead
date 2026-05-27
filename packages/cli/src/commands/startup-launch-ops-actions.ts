import { requireRbacPermission } from "../cli-rbac.js";
import { logStructuredFiles } from "./startup-launch-output.js";

export interface StartupSupportTriageCliOptions {
  cwd?: string;
  request: string;
  outcome: string;
  customer?: string;
  severity: string;
  category: string;
  source: string[];
  actor: string;
}

export interface StartupBottleneckMapCliOptions {
  cwd?: string;
  bottleneck: string[];
  owner?: string;
  systemOfRecord?: string;
  handoffDue?: string;
  status: string;
  actor: string;
}

export async function recordStartupSupportTriageCommand(
  options: StartupSupportTriageCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "record startup support triage"
  });

  const { recordSupportTriage } = await import("../startup-automation.js");
  const result = await recordSupportTriage({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    request: options.request,
    outcome: options.outcome,
    ...(options.customer === undefined ? {} : { customer: options.customer }),
    severity: options.severity,
    category: options.category,
    sourceRefs: options.source
  });

  console.log(`Recorded support triage evidence: ${result.evidenceId}`);
  for (const file of result.files) {
    console.log(`Wrote support triage file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function generateStartupBottleneckMapCommand(
  options: StartupBottleneckMapCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate founder bottleneck map"
  });

  const { generateFounderBottleneckMap } = await import("../startup-automation.js");
  const result = await generateFounderBottleneckMap({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    bottlenecks: options.bottleneck,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    ...(options.systemOfRecord === undefined
      ? {}
      : { systemOfRecord: options.systemOfRecord }),
    ...(options.handoffDue === undefined ? {} : { handoffDueDate: options.handoffDue }),
    status: options.status
  });

  console.log(`Generated founder bottleneck evidence: ${result.evidenceId}`);
  console.log(`Bottlenecks: ${result.bottlenecks.length}`);
  for (const file of result.files) {
    console.log(`Wrote bottleneck map file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}
