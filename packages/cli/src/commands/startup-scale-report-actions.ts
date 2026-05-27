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
