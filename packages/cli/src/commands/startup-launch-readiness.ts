import { requireRbacPermission } from "../cli-rbac.js";

export {
  runStartupLaunchAuditCommand,
  runStartupLaunchPrepareCommand,
  runStartupLaunchSecurityBaselineCommand
} from "./startup-launch-baseline-actions.js";
export type {
  StartupLaunchAuditCommandOptions,
  StartupLaunchPrepareCommandOptions,
  StartupLaunchSecurityBaselineCommandOptions
} from "./startup-launch-baseline-actions.js";

export interface StartupLaunchReportCommandOptions {
  cwd?: string;
  domain: string;
  print?: boolean;
  actor: string;
}

export interface StartupLaunchGitSummaryCommandOptions {
  cwd?: string;
  remote: string;
  actor: string;
}

export async function runStartupLaunchReportCommand(
  options: StartupLaunchReportCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "audit.read",
    action: "generate startup launch readiness report"
  });

  const { generateLaunchReadinessReport } =
    await import("../launch-readiness-report.js");
  const report = await generateLaunchReadinessReport({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    domain: options.domain
  });

  console.log(`Generated launch readiness report: ${report.reportPath}`);
  console.log(`Status: ${report.status}`);
  console.log(`Blockers: ${report.blockers.length}`);

  if (options.print === true) {
    console.log("");
    console.log(report.markdown);
  }
}

export async function runStartupLaunchGitSummaryCommand(
  options: StartupLaunchGitSummaryCommandOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "generate Git/GitHub launch summary"
  });

  const { generateStartupLaunchGitSummary } = await import("../startup-launch-git.js");
  const result = await generateStartupLaunchGitSummary({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    remote: options.remote
  });

  console.log(`Generated Git/GitHub launch evidence: ${result.evidenceId}`);
  console.log(`Report: ${result.markdownPath}`);
  console.log("Next commands:");
  for (const command of result.nextCommands) {
    console.log(`- ${command}`);
  }
}
