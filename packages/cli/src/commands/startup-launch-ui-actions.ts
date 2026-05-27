import { requireRbacPermission } from "../cli-rbac.js";
import {
  parsePositiveInteger,
  requireUiValidationUrl
} from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

export { runStartupLaunchUiTestScaffoldCommand } from "./startup-launch-ui-scaffold-action.js";
export type { StartupLaunchUiTestScaffoldCommandOptions } from "./startup-launch-ui-scaffold-action.js";

export interface StartupLaunchUiValidateCommandOptions {
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
}

export async function runStartupLaunchUiValidateCommand(
  options: StartupLaunchUiValidateCommandOptions
): Promise<void> {
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
                serverPort: parsePositiveInteger(options.serverPort, "--server-port")
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
          accessibilityStatus: parseStartupUiValidationStatus(options.accessibility),
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
