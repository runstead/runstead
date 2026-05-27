import { requireRbacPermission } from "../cli-rbac.js";

import { logStructuredFiles } from "./startup-scale-output.js";

export interface StartupScaleScheduleReportCommandOptions {
  cwd?: string;
  cadence: string;
  owner?: string;
  nextRun?: string;
  periodTemplate: string;
  actor: string;
}

export interface StartupScaleReportCommandOptions {
  cwd?: string;
  period?: string;
  actor: string;
}

export interface StartupScaleSopGenerateCommandOptions {
  cwd?: string;
  sop: string[];
  owner?: string;
  workflow?: string;
  actor: string;
}

export interface StartupScaleGtmVerifyCommandOptions {
  cwd?: string;
  claim: string[];
  evidence: string[];
  productState?: string;
  actor: string;
}

export async function runStartupScaleScheduleReportCommand(
  options: StartupScaleScheduleReportCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "record startup scale report schedule"
  });

  const { scheduleScaleReport } = await import("../startup-automation.js");
  const result = await scheduleScaleReport({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    cadence: options.cadence,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    ...(options.nextRun === undefined ? {} : { nextRunAt: options.nextRun }),
    periodTemplate: options.periodTemplate
  });

  console.log(`Recorded scale report schedule evidence: ${result.evidenceId}`);
  console.log(`Next command: ${result.nextCommand}`);
  for (const file of result.files) {
    console.log(`Wrote schedule file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupScaleReportCommand(
  options: StartupScaleReportCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup scale ops report"
  });

  const { generateScaleOpsReport } = await import("../startup-automation.js");
  const result = await generateScaleOpsReport({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.period === undefined ? {} : { period: options.period })
  });

  console.log(`Generated scale ops report evidence: ${result.evidenceId}`);
  console.log(`Period: ${result.period}`);
  for (const file of result.files) {
    console.log(`Wrote scale report file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupScaleSopGenerateCommand(
  options: StartupScaleSopGenerateCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup ops SOPs"
  });

  const { generateOpsSops } = await import("../startup-automation.js");
  const result = await generateOpsSops({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    sops: options.sop,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    ...(options.workflow === undefined ? {} : { workflow: options.workflow })
  });

  console.log(`Generated SOP evidence: ${result.evidenceId}`);
  console.log(`SOPs: ${result.sops.length}`);
  for (const file of result.files) {
    console.log(`Wrote SOP file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupScaleGtmVerifyCommand(
  options: StartupScaleGtmVerifyCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "verify startup GTM artifacts"
  });

  const { verifyGtmArtifacts } = await import("../startup-automation.js");
  const result = await verifyGtmArtifacts({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    claims: options.claim,
    evidenceRefs: options.evidence,
    ...(options.productState === undefined
      ? {}
      : { productState: options.productState })
  });

  console.log(`Generated GTM verification evidence: ${result.evidenceId}`);
  console.log(`Claims: ${result.claims.length}`);
  for (const file of result.files) {
    console.log(`Wrote GTM verification file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}
