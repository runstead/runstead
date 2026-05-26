import type { StartupDevServerHandle } from "./startup-dev-server.js";
import {
  persistServerLogAsset,
  persistStartupUiTextAsset,
  startupUiExecutionSources
} from "./startup-ui-validation-assets.js";
import { recordStartupUiValidation } from "./startup-ui-validation-recorder.js";
import {
  startupUiExecutionErrorCategory,
  startupUiExecutionRetryCount,
  startupUiExecutionRetryReason
} from "./startup-ui-validation-retry.js";
import {
  escapeHtml,
  executedResponsiveStatus,
  serverEvidence
} from "./startup-ui-validation-status.js";
import type {
  ExecuteStartupUiValidationOptions,
  ExecuteStartupUiValidationResult,
  StartupUiFlowAction,
  StartupUiValidationExecutionEvidence
} from "./startup-ui-validation-types.js";

export async function recordStartupUiExecutionFailure(
  options: ExecuteStartupUiValidationOptions & {
    cwd: string;
    url: string;
    server?: StartupDevServerHandle;
    flowActions: StartupUiFlowAction[];
    error: unknown;
  }
): Promise<ExecuteStartupUiValidationResult> {
  const message =
    options.error instanceof Error ? options.error.message : String(options.error);
  const retryCount = startupUiExecutionRetryCount(options.error);
  const retryReason = startupUiExecutionRetryReason(options.error);
  const html = `<!doctype html><html><body><pre>${escapeHtml(message)}</pre></body></html>`;
  const domAsset = await persistStartupUiTextAsset({
    cwd: options.cwd,
    prefix: "dom-failure",
    extension: "html",
    contents: html
  });
  const serverLogAsset = await persistServerLogAsset(options.cwd, options.server);
  const execution: StartupUiValidationExecutionEvidence = {
    runner: options.flowActions.length === 0 ? "http_dom_smoke" : "browser_flow_smoke",
    responseStatus: 0,
    responseOk: false,
    expectedText: (options.expectText ?? []).map((text) => ({
      text,
      found: false
    })),
    flowActions: options.flowActions.map((action) => ({
      type: action.type,
      status: "fail",
      summary: `not executed: ${message}`
    })),
    artifacts: {
      dom: domAsset.uri,
      ...(serverLogAsset === undefined ? {} : { serverLog: serverLogAsset.uri })
    },
    error: message,
    failureCategory: startupUiExecutionErrorCategory(message),
    ...(retryCount === undefined ? {} : { retryCount }),
    ...(retryReason === undefined ? {} : { retryReason }),
    ...serverEvidence(options.server)
  };
  const recorded = await recordStartupUiValidation({
    cwd: options.cwd,
    url: options.url,
    viewport: options.viewport,
    domStatus: "fail",
    accessibilityStatus: "fail",
    responsiveStatus: executedResponsiveStatus(options.viewport),
    ...(options.criticalFlow === undefined
      ? {}
      : { criticalFlow: options.criticalFlow }),
    criticalFlowStatus: options.flowActions.length === 0 ? "not_run" : "fail",
    domArtifact: domAsset.uri,
    consoleErrors: [message],
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
