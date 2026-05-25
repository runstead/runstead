import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";

export function registerReportCommand(program: Command): Command {
  const report = program.command("report").description("Generate reports.");

  report
    .command("weekly")
    .description("Generate a weekly Runstead maintenance report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--week <YYYY-Www>", "ISO week to report, for example 2026-W20")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action(async (options: WeeklyReportOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "generate reports"
      });

      const { generateWeeklyReport } = await import("../weekly-report.js");
      const result = await generateWeeklyReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.week === undefined ? {} : { week: options.week })
      });

      console.log(`Generated weekly report: ${result.reportPath}`);
      console.log(`Week: ${result.week}`);

      if (options.print === true) {
        console.log("");
        console.log(result.markdown);
      }
    });

  report
    .command("launch-readiness")
    .description("Generate an AI-coded MVP launch readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action(async (options: LaunchReadinessReportOptions) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "generate launch readiness reports"
      });

      const { generateLaunchReadinessReport } =
        await import("../launch-readiness-report.js");
      const result = await generateLaunchReadinessReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        domain: options.domain
      });

      console.log(`Generated launch readiness report: ${result.reportPath}`);
      console.log(`Domain: ${result.domain}`);
      console.log(`Status: ${result.status}`);
      console.log(`Blockers: ${result.blockers.length}`);

      if (options.print === true) {
        console.log("");
        console.log(result.markdown);
      }
    });

  return report;
}

interface WeeklyReportOptions {
  cwd?: string;
  week?: string;
  print?: boolean;
  actor: string;
}

interface LaunchReadinessReportOptions {
  cwd?: string;
  domain: string;
  print?: boolean;
  actor: string;
}
