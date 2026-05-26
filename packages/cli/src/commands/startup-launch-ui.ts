import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import {
  collectValues,
  parsePositiveInteger,
  requireUiValidationUrl
} from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

export function registerUiValidateCommand(startupLaunch: Command): void {
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

export function registerUiTestScaffoldCommand(startupLaunch: Command): void {
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
