import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";
import {
  registerUiTestScaffoldCommand,
  registerUiValidateCommand
} from "./startup-launch-ui.js";

export function registerStartupLaunchCommand(startup: Command): Command {
  const startupLaunch = startup
    .command("launch")
    .description("Generate startup launch readiness artifacts.");

  registerAuditCommand(startupLaunch);
  registerSecurityBaselineCommand(startupLaunch);
  registerPrepareCommand(startupLaunch);
  registerReportCommand(startupLaunch);
  registerSupportTriageCommand(startupLaunch);
  registerGitSummaryCommand(startupLaunch);
  registerUiValidateCommand(startupLaunch);
  registerUiTestScaffoldCommand(startupLaunch);
  registerBottleneckMapCommand(startupLaunch);

  return startupLaunch;
}

function registerAuditCommand(startupLaunch: Command): void {
  startupLaunch
    .command("audit")
    .description("Inspect repo readiness and record launch audit evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for launch audit generation", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
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
    });
}

function registerSecurityBaselineCommand(startupLaunch: Command): void {
  startupLaunch
    .command("security-baseline")
    .description("Record protected-path, env, and dependency baseline evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--actor <id>",
      "RBAC subject for security baseline generation",
      "local-admin"
    )
    .action(async (options: { cwd?: string; actor: string }) => {
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
    });
}

function registerPrepareCommand(startupLaunch: Command): void {
  startupLaunch
    .command("prepare")
    .description("Prepare launch readiness artifacts and generate a readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for launch preparation", "local-admin")
    .action(async (options: { cwd?: string; domain: string; actor: string }) => {
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
    });
}

function registerReportCommand(startupLaunch: Command): void {
  startupLaunch
    .command("report")
    .description("Generate the startup launch readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        domain: string;
        print?: boolean;
        actor: string;
      }) => {
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
    );
}

function registerSupportTriageCommand(startupLaunch: Command): void {
  startupLaunch
    .command("support-triage")
    .description("Record evidence-backed support triage for launch readiness.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--request <text>", "Support request or issue summary")
    .requiredOption("--outcome <text>", "Triage outcome and next action")
    .option("--customer <text>", "Customer or account identifier")
    .option("--severity <level>", "Severity label", "medium")
    .option("--category <name>", "Support category", "uncategorized")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--actor <id>", "RBAC subject for support triage writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        request: string;
        outcome: string;
        customer?: string;
        severity: string;
        category: string;
        source: string[];
        actor: string;
      }) => {
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
    );
}

function registerGitSummaryCommand(startupLaunch: Command): void {
  startupLaunch
    .command("git-summary")
    .description("Generate first commit, push, PR, and GitHub Actions launch guidance.")
    .option("--cwd <path>", "Workspace directory")
    .option("--remote <name>", "Git remote to inspect", "origin")
    .option("--actor <id>", "RBAC subject for Git/GitHub launch summary", "local-admin")
    .action(async (options: { cwd?: string; remote: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "generate Git/GitHub launch summary"
      });

      const { generateStartupLaunchGitSummary } =
        await import("../startup-launch-git.js");
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
    });
}

function registerBottleneckMapCommand(startupLaunch: Command): void {
  startupLaunch
    .command("bottleneck-map")
    .description("Generate founder bottleneck audit evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--bottleneck <text>",
      "Founder-only bottleneck to record",
      collectValues,
      []
    )
    .option("--owner <text>", "Handoff owner")
    .option("--system-of-record <text>", "Durable system of record")
    .option("--handoff-due <date>", "Handoff due date")
    .option(
      "--status <status>",
      "Handoff status: open, handoff-in-progress, or handoff-complete",
      "handoff-in-progress"
    )
    .option("--actor <id>", "RBAC subject for bottleneck audit writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        bottleneck: string[];
        owner?: string;
        systemOfRecord?: string;
        handoffDue?: string;
        status: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate founder bottleneck map"
        });

        const { generateFounderBottleneckMap } =
          await import("../startup-automation.js");
        const result = await generateFounderBottleneckMap({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          bottlenecks: options.bottleneck,
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.systemOfRecord === undefined
            ? {}
            : { systemOfRecord: options.systemOfRecord }),
          ...(options.handoffDue === undefined
            ? {}
            : { handoffDueDate: options.handoffDue }),
          status: options.status
        });

        console.log(`Generated founder bottleneck evidence: ${result.evidenceId}`);
        console.log(`Bottlenecks: ${result.bottlenecks.length}`);
        for (const file of result.files) {
          console.log(`Wrote bottleneck map file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );
}

function logStructuredFiles(files: string[]): void {
  for (const file of files) {
    console.log(`Wrote structured artifact: ${file}`);
  }
}
