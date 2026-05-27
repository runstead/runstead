import { defaultStartupUiBrowserRunner } from "./startup-ui-browser-runner.js";
import {
  persistConsoleLogAsset,
  persistServerLogAsset,
  persistStartupUiBinaryAsset,
  persistStartupUiTextAsset,
  startupUiExecutionSources
} from "./startup-ui-validation-assets.js";
import { runStartupUiBrowserRunnerWithRetry } from "./startup-ui-validation-retry.js";
import {
  executedAccessibilityStatus,
  executedResponsiveStatus,
  serverEvidence,
  textChecks
} from "./startup-ui-validation-status.js";
import { recordStartupUiValidation } from "./startup-ui-validation-recorder.js";
import { recordStartupUiExecutionFailure } from "./startup-ui-validation-failure.js";
import type { StartupDevServerHandle } from "./startup-dev-server.js";
import type {
  ExecuteStartupUiValidationOptions,
  ExecuteStartupUiValidationResult,
  StartupUiFlowAction,
  StartupUiValidationExecutionEvidence
} from "./startup-ui-validation-types.js";

export async function executeBrowserFlowValidation(
  options: ExecuteStartupUiValidationOptions & {
    cwd: string;
    url: string;
    server?: StartupDevServerHandle;
    flowActions: StartupUiFlowAction[];
  }
): Promise<ExecuteStartupUiValidationResult> {
  try {
    const runner = options.browserRunner ?? defaultStartupUiBrowserRunner;
    const browserInput = {
      url: options.url,
      viewport: options.viewport,
      expectText: options.expectText ?? [],
      flowActions: options.flowActions,
      timeoutMs: options.timeoutMs ?? 20_000
    };
    const {
      result: browser,
      retryCount,
      retryReason
    } = await runStartupUiBrowserRunnerWithRetry(runner, browserInput);
    const domAsset = await persistStartupUiTextAsset({
      cwd: options.cwd,
      prefix: "dom",
      extension: "html",
      contents: browser.html
    });
    const screenshotAsset =
      browser.screenshot === undefined
        ? undefined
        : await persistStartupUiBinaryAsset({
            cwd: options.cwd,
            prefix: "screenshot",
            extension: "png",
            contents: browser.screenshot
          });
    const consoleAsset = await persistConsoleLogAsset(
      options.cwd,
      browser.consoleMessages
    );
    const serverLogAsset = await persistServerLogAsset(options.cwd, options.server);
    const expectedText = textChecks(browser.html, options.expectText ?? []);
    const domStatus =
      browser.responseOk && expectedText.every((item) => item.found) ? "pass" : "fail";
    const accessibilityStatus = executedAccessibilityStatus(browser.html);
    const responsiveStatus = executedResponsiveStatus(options.viewport);
    const criticalFlowStatus = browser.actionResults.every(
      (action) => action.status !== "fail"
    )
      ? "pass"
      : "fail";
    const execution: StartupUiValidationExecutionEvidence = {
      runner: "browser_flow_smoke",
      responseStatus: browser.responseStatus,
      responseOk: browser.responseOk,
      expectedText,
      flowActions: browser.actionResults,
      ...(retryCount === 0 ? {} : { retryCount }),
      ...(retryReason === undefined ? {} : { retryReason }),
      artifacts: {
        dom: domAsset.uri,
        ...(screenshotAsset === undefined ? {} : { screenshot: screenshotAsset.uri }),
        ...(consoleAsset === undefined ? {} : { consoleLog: consoleAsset.uri }),
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
      ...(screenshotAsset === undefined ? {} : { screenshot: screenshotAsset.uri }),
      consoleErrors: browser.consoleMessages.filter((message) =>
        /^\[(error|warn|warning)\]/i.test(message)
      ),
      execution,
      sources: startupUiExecutionSources(
        domAsset,
        screenshotAsset,
        consoleAsset,
        serverLogAsset
      ),
      ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      ...recorded,
      url: options.url,
      domArtifact: domAsset.uri,
      execution
    };
  } catch (error) {
    return recordStartupUiExecutionFailure({
      ...options,
      error
    });
  }
}
