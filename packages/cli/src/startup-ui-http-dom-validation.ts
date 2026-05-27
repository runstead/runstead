import {
  persistServerLogAsset,
  persistStartupUiTextAsset,
  startupUiExecutionSources
} from "./startup-ui-validation-assets.js";
import {
  executedAccessibilityStatus,
  executedDomStatus,
  executedResponsiveStatus,
  serverEvidence,
  textChecks
} from "./startup-ui-validation-status.js";
import { recordStartupUiValidation } from "./startup-ui-validation-recorder.js";
import type { StartupDevServerHandle } from "./startup-dev-server.js";
import type {
  ExecuteStartupUiValidationOptions,
  ExecuteStartupUiValidationResult,
  StartupUiValidationExecutionEvidence
} from "./startup-ui-validation-types.js";

export async function executeHttpDomValidation(
  options: ExecuteStartupUiValidationOptions & {
    cwd: string;
    url: string;
    server?: StartupDevServerHandle;
  }
): Promise<ExecuteStartupUiValidationResult> {
  const response = await (options.fetchImpl ?? fetch)(options.url);
  const html = await response.text();
  const domAsset = await persistStartupUiTextAsset({
    cwd: options.cwd,
    prefix: "dom",
    extension: "html",
    contents: html
  });
  const serverLogAsset = await persistServerLogAsset(options.cwd, options.server);
  const expectedText = textChecks(html, options.expectText ?? []);
  const domStatus = executedDomStatus(response, html, expectedText);
  const accessibilityStatus = executedAccessibilityStatus(html);
  const responsiveStatus = executedResponsiveStatus(options.viewport);
  const criticalFlowStatus = options.criticalFlow === undefined ? "not_run" : domStatus;
  const execution: StartupUiValidationExecutionEvidence = {
    runner: "http_dom_smoke",
    responseStatus: response.status,
    responseOk: response.ok,
    expectedText,
    artifacts: {
      dom: domAsset.uri,
      ...(serverLogAsset === undefined ? {} : { serverLog: serverLogAsset.uri })
    },
    ...serverEvidence(options.server)
  };
  const recorded = await recordStartupUiValidation({
    cwd: options.cwd,
    url: options.url,
    viewport: options.viewport,
    domStatus,
    accessibilityStatus,
    responsiveStatus,
    ...(options.criticalFlow === undefined
      ? {}
      : { criticalFlow: options.criticalFlow }),
    criticalFlowStatus,
    domArtifact: domAsset.uri,
    consoleErrors: [],
    execution,
    sources: startupUiExecutionSources(domAsset, undefined, undefined, serverLogAsset),
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    ...recorded,
    url: options.url,
    domArtifact: domAsset.uri,
    execution
  };
}
