import { resolve } from "node:path";

import {
  classifyRuntimeStartupUiValidationFailure,
  runtimeStartupUiValidationInfraStatus,
  runtimeStartupUiValidationRepairHint,
  type RuntimeStartupUiValidationExecutionEvidence,
  type RuntimeStartupUiValidationFailureCategory,
  type RuntimeStartupUiValidationStatus
} from "@runstead/runtime";

import { defaultStartupUiBrowserRunner } from "./startup-ui-browser-runner.js";
import {
  persistConsoleLogAsset,
  persistServerLogAsset,
  persistStartupUiBinaryAsset,
  persistStartupUiScreenshot,
  persistStartupUiTextAsset,
  startupUiExecutionSources
} from "./startup-ui-validation-assets.js";
import {
  startStartupDevServer,
  type StartupDevServerHandle
} from "./startup-dev-server.js";
import {
  runStartupUiBrowserRunnerWithRetry,
  startupUiExecutionErrorCategory,
  startupUiExecutionRetryCount,
  startupUiExecutionRetryReason
} from "./startup-ui-validation-retry.js";
import {
  escapeHtml,
  executedAccessibilityStatus,
  executedDomStatus,
  executedResponsiveStatus,
  serverEvidence,
  textChecks,
  uiValidationFailed
} from "./startup-ui-validation-status.js";
import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceSourceInput
} from "./startup-evidence.js";

export {
  parseStartupUiValidationStatus,
  summarizeStartupUiValidationFailure
} from "./startup-ui-validation-status.js";

export type StartupUiValidationStatus = RuntimeStartupUiValidationStatus;
export type StartupUiValidationFailureCategory =
  RuntimeStartupUiValidationFailureCategory;

export interface RecordStartupUiValidationOptions {
  cwd?: string;
  url: string;
  viewport: string;
  screenshot?: string;
  domStatus?: StartupUiValidationStatus;
  accessibilityStatus?: StartupUiValidationStatus;
  responsiveStatus?: StartupUiValidationStatus;
  criticalFlow?: string;
  criticalFlowStatus?: StartupUiValidationStatus;
  domArtifact?: string;
  consoleErrors?: string[];
  execution?: StartupUiValidationExecutionEvidence;
  sourceRefs?: string[];
  sources?: StartupEvidenceSourceInput[];
  goalId?: string;
  now?: Date;
}

export interface RecordStartupUiValidationResult {
  evidence: AddStartupEvidenceResult;
  failed: boolean;
}

export interface ExecuteStartupUiValidationOptions {
  cwd?: string;
  url?: string;
  viewport: string;
  criticalFlow?: string;
  expectText?: string[];
  flowActions?: StartupUiFlowAction[];
  serverCommand?: string;
  serverPort?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  browserRunner?: StartupUiBrowserRunner;
  goalId?: string;
  now?: Date;
}

export interface ExecuteStartupUiValidationResult extends RecordStartupUiValidationResult {
  url: string;
  domArtifact: string;
  execution: StartupUiValidationExecutionEvidence;
}

export type StartupUiValidationExecutionEvidence =
  RuntimeStartupUiValidationExecutionEvidence;

export interface StartupUiValidationTextCheck {
  text: string;
  found: boolean;
}

export interface StartupUiValidationServerEvidence {
  managed: boolean;
  command: string;
  url: string;
  port: number;
}

export type StartupUiFlowAction =
  | {
      type: "fill";
      selector?: string;
      selectors?: string[];
      value: string;
    }
  | {
      type: "select";
      selector?: string;
      selectors?: string[];
      value: string;
    }
  | {
      type: "click";
      selector?: string;
      selectors?: string[];
    }
  | {
      type: "expectText";
      text: string;
    }
  | {
      type: "expectCount";
      selector: string;
      count: number;
    }
  | {
      type: "reload";
    }
  | {
      type: "expectPersisted";
      text: string;
      selector?: string;
      selectors?: string[];
    }
  | {
      type: "expectNoOverlap";
      selectors: string[];
    };

export interface StartupUiFlowActionResult {
  type: StartupUiFlowAction["type"];
  status: StartupUiValidationStatus;
  summary: string;
  selector?: string;
  expected?: string | number;
  actual?: string | number;
}

export const classifyStartupUiValidationFailure =
  classifyRuntimeStartupUiValidationFailure;
export const startupUiValidationRepairHint = runtimeStartupUiValidationRepairHint;
export const startupUiValidationInfraStatus = runtimeStartupUiValidationInfraStatus;

export interface StartupUiValidationExecutionArtifacts {
  dom?: string;
  screenshot?: string;
  consoleLog?: string;
  serverLog?: string;
}

export interface StartupUiBrowserRunnerInput {
  url: string;
  viewport: string;
  expectText: string[];
  flowActions: StartupUiFlowAction[];
  timeoutMs: number;
}

export interface StartupUiBrowserRunnerResult {
  responseStatus: number;
  responseOk: boolean;
  html: string;
  screenshot?: Buffer;
  consoleMessages: string[];
  actionResults: StartupUiFlowActionResult[];
}

export type StartupUiBrowserRunner = (
  input: StartupUiBrowserRunnerInput
) => Promise<StartupUiBrowserRunnerResult>;

export async function recordStartupUiValidation(
  options: RecordStartupUiValidationOptions
): Promise<RecordStartupUiValidationResult> {
  const persistedScreenshot = await persistStartupUiScreenshot({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.screenshot === undefined ? {} : { screenshot: options.screenshot })
  });
  const screenshot = persistedScreenshot?.uri ?? options.screenshot;
  const content = {
    url: options.url,
    viewport: options.viewport,
    ...(screenshot === undefined ? {} : { screenshot }),
    ...(persistedScreenshot?.originalUri === undefined
      ? {}
      : { originalScreenshot: persistedScreenshot.originalUri }),
    domStatus: options.domStatus ?? "not_run",
    accessibilityStatus: options.accessibilityStatus ?? "not_run",
    responsiveStatus: options.responsiveStatus ?? "not_run",
    infraStatus: startupUiValidationInfraStatus(options.execution),
    ...(options.criticalFlow === undefined
      ? {}
      : { criticalFlow: options.criticalFlow }),
    criticalFlowStatus: options.criticalFlowStatus ?? "not_run",
    ...(options.domArtifact === undefined ? {} : { domArtifact: options.domArtifact }),
    ...(options.consoleErrors === undefined
      ? {}
      : { consoleErrors: options.consoleErrors }),
    ...(options.execution === undefined ? {} : { execution: options.execution })
  };
  const failed = uiValidationFailed(content);
  const sourceRefs = [
    ...(options.sourceRefs ?? []),
    ...(screenshot === undefined ? [] : [screenshot])
  ];
  const sources =
    options.sources ??
    (screenshot === undefined
      ? undefined
      : [
          {
            kind: "browser_ui",
            uri: screenshot,
            ...(persistedScreenshot?.hash === undefined
              ? {}
              : { hash: persistedScreenshot.hash })
          }
        ]);
  const evidence = await addStartupEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    type: "ui_validation",
    summary: `UI validation ${failed ? "failed" : "recorded"} for ${options.url} ${options.viewport}`,
    sourceRefs,
    ...(sources === undefined ? {} : { sources }),
    content: JSON.stringify(content, null, 2),
    gate: "launch",
    ...(options.goalId === undefined ? {} : { goalId: options.goalId }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    evidence,
    failed
  };
}

export async function executeStartupUiValidation(
  options: ExecuteStartupUiValidationOptions
): Promise<ExecuteStartupUiValidationResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let server: StartupDevServerHandle | undefined;
  const flowActions = options.flowActions ?? [];

  try {
    if (options.serverCommand !== undefined || options.url === undefined) {
      server = await startStartupDevServer({
        cwd,
        ...(options.serverCommand === undefined
          ? {}
          : { command: options.serverCommand }),
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.serverPort === undefined ? {} : { port: options.serverPort }),
        timeoutMs: options.timeoutMs ?? 20_000,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
      });
    }

    const url = server?.url ?? options.url;

    if (url === undefined) {
      throw new Error("UI validation execution requires a URL or a dev server command");
    }

    const serverOption = server === undefined ? {} : { server };

    return flowActions.length === 0
      ? await executeHttpDomValidation({ ...options, cwd, url, ...serverOption })
      : await executeBrowserFlowValidation({
          ...options,
          cwd,
          url,
          ...serverOption,
          flowActions
        });
  } finally {
    await server?.stop();
  }
}

async function executeHttpDomValidation(
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

async function executeBrowserFlowValidation(
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

async function recordStartupUiExecutionFailure(
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
