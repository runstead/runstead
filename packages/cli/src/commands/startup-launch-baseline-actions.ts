import { requireRbacPermission } from "../cli-rbac.js";

import { logStructuredFiles } from "./startup-launch-output.js";

export interface StartupLaunchAuditCommandOptions {
  cwd?: string;
  actor: string;
}

export interface StartupLaunchSecurityBaselineCommandOptions {
  cwd?: string;
  actor: string;
}

export interface StartupLaunchPrepareCommandOptions {
  cwd?: string;
  domain: string;
  actor: string;
}

export async function runStartupLaunchAuditCommand(
  options: StartupLaunchAuditCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup launch audit"
  });

  const { generateRepoReadinessAudit } = await import("../startup-automation.js");
  const result = await generateRepoReadinessAudit({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(`Generated repo readiness evidence: ${result.evidenceId}`);
  console.log(`Blockers: ${result.blockers.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  for (const file of result.files) {
    console.log(`Wrote launch audit file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupLaunchSecurityBaselineCommand(
  options: StartupLaunchSecurityBaselineCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate startup security baseline"
  });

  const { generateSecurityBaseline } = await import("../startup-automation.js");
  const result = await generateSecurityBaseline({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  console.log(`Generated security baseline evidence: ${result.evidenceId}`);
  console.log(`Blockers: ${result.blockers.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  for (const file of result.files) {
    console.log(`Wrote security baseline file: ${file}`);
  }
  logStructuredFiles(result.structuredFiles);
}

export async function runStartupLaunchPrepareCommand(
  options: StartupLaunchPrepareCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "prepare startup launch readiness"
  });
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "audit.read",
    action: "generate startup launch readiness report"
  });

  const { generateRepoReadinessAudit, generateSecurityBaseline } =
    await import("../startup-automation.js");
  const { generateLaunchReadinessReport } =
    await import("../launch-readiness-report.js");
  const readiness = await generateRepoReadinessAudit({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });
  const security = await generateSecurityBaseline({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });
  const report = await generateLaunchReadinessReport({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    domain: options.domain
  });

  console.log(`Prepared repo readiness evidence: ${readiness.evidenceId}`);
  console.log(`Prepared security baseline evidence: ${security.evidenceId}`);
  console.log(`Generated launch readiness report: ${report.reportPath}`);
  console.log(`Status: ${report.status}`);
  console.log(`Blockers: ${report.blockers.length}`);
}
