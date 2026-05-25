import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import {
  collectValues,
  parsePositiveInteger,
  requireUiValidationUrl
} from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

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

function registerUiValidateCommand(startupLaunch: Command): void {
  startupLaunch
    .command("ui-validate")
    .description(
      "Record screenshot, DOM, accessibility, responsive, and flow UI validation evidence."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--url <url>", "Validated local or deployed URL")
    .requiredOption("--viewport <viewport>", "Viewport label or dimensions")
    .option(
      "--execute",
      "Run an automated DOM/UI validation smoke before recording evidence"
    )
    .option("--server-command <command>", "Command used to start a local dev server")
    .option("--server-port <port>", "Preferred local dev server port")
    .option("--execute-timeout-ms <ms>", "Dev server startup timeout in milliseconds")
    .option(
      "--expect-text <text>",
      "Text that must appear in the executed DOM",
      collectValues,
      []
    )
    .option("--screenshot <ref>", "Screenshot artifact URI or path")
    .option("--dom <status>", "DOM smoke status: pass, fail, or not_run", "not_run")
    .option(
      "--accessibility <status>",
      "Accessibility check status: pass, fail, or not_run",
      "not_run"
    )
    .option(
      "--responsive <status>",
      "Responsive viewport status: pass, fail, or not_run",
      "not_run"
    )
    .option("--flow <name>", "Critical user flow name")
    .option(
      "--flow-status <status>",
      "Critical flow status: pass, fail, or not_run",
      "not_run"
    )
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical browser/UI source URI")
    .option("--source-kind <kind>", "Source kind, usually browser_ui")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for UI validation writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        url?: string;
        viewport: string;
        execute?: boolean;
        serverCommand?: string;
        serverPort?: string;
        executeTimeoutMs?: string;
        expectText: string[];
        screenshot?: string;
        dom: string;
        accessibility: string;
        responsive: string;
        flow?: string;
        flowStatus: string;
        source: string[];
        sourceUri?: string;
        sourceKind?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup UI validation"
        });

        const {
          executeStartupUiValidation,
          parseStartupUiValidationStatus,
          recordStartupUiValidation
        } = await import("../startup-ui-validation.js");
        const result =
          options.execute === true
            ? await executeStartupUiValidation({
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
                ...(options.url === undefined ? {} : { url: options.url }),
                viewport: options.viewport,
                ...(options.flow === undefined ? {} : { criticalFlow: options.flow }),
                expectText: options.expectText,
                ...(options.serverCommand === undefined
                  ? {}
                  : { serverCommand: options.serverCommand }),
                ...(options.serverPort === undefined
                  ? {}
                  : {
                      serverPort: parsePositiveInteger(
                        options.serverPort,
                        "--server-port"
                      )
                    }),
                ...(options.executeTimeoutMs === undefined
                  ? {}
                  : {
                      timeoutMs: parsePositiveInteger(
                        options.executeTimeoutMs,
                        "--execute-timeout-ms"
                      )
                    }),
                ...(options.goal === undefined ? {} : { goalId: options.goal })
              })
            : await recordStartupUiValidation({
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
                url: requireUiValidationUrl(options.url),
                viewport: options.viewport,
                ...(options.screenshot === undefined
                  ? {}
                  : { screenshot: options.screenshot }),
                domStatus: parseStartupUiValidationStatus(options.dom),
                accessibilityStatus: parseStartupUiValidationStatus(
                  options.accessibility
                ),
                responsiveStatus: parseStartupUiValidationStatus(options.responsive),
                ...(options.flow === undefined ? {} : { criticalFlow: options.flow }),
                criticalFlowStatus: parseStartupUiValidationStatus(options.flowStatus),
                sourceRefs: options.source,
                ...evidenceSourceDetails(options),
                ...(options.goal === undefined ? {} : { goalId: options.goal })
              });

        console.log(`Recorded UI validation evidence: ${result.evidence.evidence.id}`);
        console.log(`Failed: ${result.failed ? "yes" : "no"}`);
        const executedDomArtifact =
          "domArtifact" in result ? String(result.domArtifact) : undefined;

        if (executedDomArtifact !== undefined) {
          console.log(`Executed DOM artifact: ${executedDomArtifact}`);
        }
        console.log(`Artifact: ${result.evidence.artifactPath}`);
      }
    );
}

function registerUiTestScaffoldCommand(startupLaunch: Command): void {
  startupLaunch
    .command("ui-test-scaffold")
    .description("Generate a project DOM/UI smoke test scaffold for MVP flows.")
    .option("--cwd <path>", "Workspace directory")
    .option("--url <url>", "Default UI URL for the generated smoke test")
    .option("--test-path <path>", "Test file path to write")
    .option("--flow <name>", "Critical user flow name")
    .option(
      "--expect-text <text>",
      "Text expected in the rendered UI",
      collectValues,
      []
    )
    .option("--actor <id>", "RBAC subject for UI test scaffold writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        url?: string;
        testPath?: string;
        flow?: string;
        expectText: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup UI test scaffold"
        });

        const { formatStartupUiTestScaffold, generateStartupUiTestScaffold } =
          await import("../startup-ui-test-scaffold.js");
        const result = await generateStartupUiTestScaffold({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.url === undefined ? {} : { url: options.url }),
          ...(options.testPath === undefined ? {} : { testPath: options.testPath }),
          ...(options.flow === undefined ? {} : { flow: options.flow }),
          expectText: options.expectText
        });

        console.log(formatStartupUiTestScaffold(result));
      }
    );
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
