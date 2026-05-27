import { requireRbacPermission } from "../cli-rbac.js";

import { logStructuredFiles } from "./startup-scale-output.js";

export {
  runStartupScaleReportCommand,
  runStartupScaleScheduleReportCommand
} from "./startup-scale-report-actions.js";
export type {
  StartupScaleReportCommandOptions,
  StartupScaleScheduleReportCommandOptions
} from "./startup-scale-report-actions.js";

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
