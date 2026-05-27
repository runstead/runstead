import { requireRbacPermission } from "../cli-rbac.js";
import {
  parsePositiveInteger,
  requireUiValidationUrl
} from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";

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

export interface StartupLaunchUiTestScaffoldCommandOptions {
  cwd?: string;
  url?: string;
  testPath?: string;
  flow?: string;
  expectText: string[];
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

export async function runStartupLaunchUiTestScaffoldCommand(
  options: StartupLaunchUiTestScaffoldCommandOptions
): Promise<void> {
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
