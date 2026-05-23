import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  classifyRuntimeStartupUiValidationFailure,
  runtimeStartupUiValidationInfraStatus,
  runtimeStartupUiValidationRepairHint,
  type RuntimeStartupUiValidationExecutionEvidence,
  type RuntimeStartupUiValidationFailureCategory,
  type RuntimeStartupUiValidationStatus
} from "@runstead/runtime";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  startStartupDevServer,
  type StartupDevServerHandle
} from "./startup-dev-server.js";
import {
  addStartupEvidence,
  type AddStartupEvidenceResult,
  type StartupEvidenceSourceInput
} from "./startup-evidence.js";

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
    };

export interface StartupUiFlowActionResult {
  type: StartupUiFlowAction["type"];
  status: StartupUiValidationStatus;
  summary: string;
  selector?: string;
  expected?: string | number;
  actual?: string | number;
}

export function summarizeStartupUiValidationFailure(
  execution: StartupUiValidationExecutionEvidence
): string {
  const failedAction = execution.flowActions?.find(
    (action) => action.status === "fail"
  );

  if (failedAction !== undefined) {
    return startupUiFlowActionFailureSummary(failedAction);
  }

  const missingText = execution.expectedText.find((item) => !item.found);

  if (missingText !== undefined) {
    return `expected text was not visible: ${JSON.stringify(missingText.text)}`;
  }

  if (!execution.responseOk) {
    return execution.responseStatus === 0
      ? "page did not load"
      : `page returned HTTP ${execution.responseStatus}`;
  }

  return execution.error ?? "one or more UI validation checks failed";
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

async function persistStartupUiScreenshot(input: {
  cwd?: string;
  screenshot?: string;
}): Promise<{ uri: string; originalUri: string; hash: string } | undefined> {
  if (input.screenshot === undefined) {
    return undefined;
  }

  const sourcePath = localScreenshotPath(input.screenshot, input.cwd);

  if (sourcePath === undefined) {
    return undefined;
  }

  try {
    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const cwd = resolve(input.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const contents = await readFile(sourcePath);
  const hash = sha256(contents);
  const assetsDir = join(state.root, "evidence", "assets");
  const sourceBaseName = basename(sourcePath);
  const targetName = sourceBaseName.startsWith(`${hash.slice(0, 12)}-`)
    ? sourceBaseName
    : `${hash.slice(0, 12)}-${sourceBaseName}`;
  const targetPath = join(assetsDir, targetName);

  if (resolve(sourcePath) !== resolve(targetPath)) {
    await mkdir(assetsDir, { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  return {
    uri: pathToFileURL(targetPath).href,
    originalUri: input.screenshot,
    hash: `sha256:${hash}`
  };
}

async function persistStartupUiTextAsset(input: {
  cwd: string;
  prefix: string;
  extension: string;
  contents: string;
}): Promise<{ uri: string; hash: string }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const hash = sha256(Buffer.from(input.contents));
  const assetsDir = join(state.root, "evidence", "assets");
  const targetPath = join(
    assetsDir,
    `${hash.slice(0, 12)}-${input.prefix}.${input.extension}`
  );

  await mkdir(assetsDir, { recursive: true });
  await writeFile(targetPath, input.contents, "utf8");

  return {
    uri: pathToFileURL(targetPath).href,
    hash: `sha256:${hash}`
  };
}

async function persistStartupUiBinaryAsset(input: {
  cwd: string;
  prefix: string;
  extension: string;
  contents: Buffer;
}): Promise<{ uri: string; hash: string }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const hash = sha256(input.contents);
  const assetsDir = join(state.root, "evidence", "assets");
  const targetPath = join(
    assetsDir,
    `${hash.slice(0, 12)}-${input.prefix}.${input.extension}`
  );

  await mkdir(assetsDir, { recursive: true });
  await writeFile(targetPath, input.contents);

  return {
    uri: pathToFileURL(targetPath).href,
    hash: `sha256:${hash}`
  };
}

async function persistConsoleLogAsset(
  cwd: string,
  messages: string[]
): Promise<{ uri: string; hash: string } | undefined> {
  if (messages.length === 0) {
    return undefined;
  }

  return persistStartupUiTextAsset({
    cwd,
    prefix: "console",
    extension: "log",
    contents: `${messages.join("\n")}\n`
  });
}

async function persistServerLogAsset(
  cwd: string,
  server: StartupDevServerHandle | undefined
): Promise<{ uri: string; hash: string } | undefined> {
  const logs = server?.logs();

  if (
    logs === undefined ||
    (logs.stdout.trim().length === 0 && logs.stderr.trim().length === 0)
  ) {
    return undefined;
  }

  return persistStartupUiTextAsset({
    cwd,
    prefix: "server",
    extension: "log",
    contents: [
      "# stdout",
      logs.stdout.trimEnd(),
      "",
      "# stderr",
      logs.stderr.trimEnd(),
      ""
    ].join("\n")
  });
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

function startupUiExecutionErrorCategory(
  message: string
): StartupUiValidationFailureCategory {
  const text = message.toLowerCase();

  if (
    text.includes("chrome") ||
    text.includes("devtools") ||
    text.includes("playwright") ||
    text.includes("browser") ||
    text.includes("executable") ||
    text.includes("profile")
  ) {
    return "browser_runtime";
  }

  if (
    text.includes("econnrefused") ||
    text.includes("connection refused") ||
    text.includes("timed out")
  ) {
    return "network";
  }

  if (text.includes("selector")) {
    return "selector_unstable";
  }

  return "unknown";
}

async function runStartupUiBrowserRunnerWithRetry(
  runner: StartupUiBrowserRunner,
  input: StartupUiBrowserRunnerInput
): Promise<{
  result: StartupUiBrowserRunnerResult;
  retryCount: number;
  retryReason?: string;
}> {
  try {
    return {
      result: await runner(input),
      retryCount: 0
    };
  } catch (error) {
    if (!isRetryableStartupUiInfraError(error)) {
      throw error;
    }

    const retryReason = errorMessage(error);

    try {
      return {
        result: await runner(input),
        retryCount: 1,
        retryReason
      };
    } catch (retryError) {
      throw new StartupUiBrowserRetryError(retryReason, errorMessage(retryError));
    }
  }
}

function isRetryableStartupUiInfraError(error: unknown): boolean {
  const category = startupUiExecutionErrorCategory(errorMessage(error));

  return category === "browser_runtime" || category === "network";
}

function startupUiExecutionRetryCount(error: unknown): number | undefined {
  return error instanceof StartupUiBrowserRetryError ? error.retryCount : undefined;
}

function startupUiExecutionRetryReason(error: unknown): string | undefined {
  return error instanceof StartupUiBrowserRetryError ? error.retryReason : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StartupUiBrowserRetryError extends Error {
  readonly retryCount = 1;
  readonly retryReason: string;

  constructor(firstMessage: string, retryMessage: string) {
    super(
      `UI smoke browser infrastructure failed after retry: ${retryMessage}; first failure: ${firstMessage}`
    );
    this.name = "StartupUiBrowserRetryError";
    this.retryReason = firstMessage;
  }
}

function localScreenshotPath(screenshot: string, cwd?: string): string | undefined {
  if (screenshot.startsWith("file://")) {
    return fileURLToPath(screenshot);
  }

  if (screenshot.startsWith("file:")) {
    return undefined;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(screenshot)) {
    return undefined;
  }

  return resolve(cwd ?? process.cwd(), screenshot);
}

function textChecks(
  html: string,
  expectText: string[]
): StartupUiValidationTextCheck[] {
  return expectText.map((text) => ({
    text,
    found: html.includes(text)
  }));
}

function startupUiFlowActionFailureSummary(
  action: NonNullable<StartupUiValidationExecutionEvidence["flowActions"]>[number]
): string {
  const selector =
    action.selector === undefined || action.selector.length === 0
      ? ""
      : ` selector ${JSON.stringify(action.selector)}`;
  const expected =
    action.expected === undefined ? "" : ` expected ${JSON.stringify(action.expected)}`;
  const actual =
    action.actual === undefined ? "" : ` actual ${JSON.stringify(action.actual)}`;

  return `user action ${action.type}${selector}${expected}${actual} failed: ${action.summary}`;
}

function startupUiExecutionSources(
  domAsset: { uri: string; hash: string },
  screenshotAsset: { uri: string; hash: string } | undefined,
  consoleAsset: { uri: string; hash: string } | undefined,
  serverLogAsset: { uri: string; hash: string } | undefined
): StartupEvidenceSourceInput[] {
  return [
    {
      kind: "browser_ui",
      uri: domAsset.uri,
      hash: domAsset.hash
    },
    ...(screenshotAsset === undefined
      ? []
      : [
          {
            kind: "browser_ui",
            uri: screenshotAsset.uri,
            hash: screenshotAsset.hash
          }
        ]),
    ...(consoleAsset === undefined
      ? []
      : [
          {
            kind: "browser_ui",
            uri: consoleAsset.uri,
            hash: consoleAsset.hash
          }
        ]),
    ...(serverLogAsset === undefined
      ? []
      : [
          {
            kind: "command_output",
            uri: serverLogAsset.uri,
            hash: serverLogAsset.hash
          }
        ])
  ];
}

function serverEvidence(
  server: StartupDevServerHandle | undefined
): { server: StartupUiValidationServerEvidence } | object {
  return server === undefined
    ? {}
    : {
        server: {
          managed: server.managed,
          command: server.command,
          url: server.url,
          port: server.port
        }
      };
}

async function defaultStartupUiBrowserRunner(
  input: StartupUiBrowserRunnerInput
): Promise<StartupUiBrowserRunnerResult> {
  try {
    return await runPlaywrightBrowserFlow(input);
  } catch (error) {
    if (isMissingPlaywrightError(error)) {
      return runChromeDevtoolsBrowserFlow(input);
    }

    throw error;
  }
}

async function runPlaywrightBrowserFlow(
  input: StartupUiBrowserRunnerInput
): Promise<StartupUiBrowserRunnerResult> {
  const imported = (await dynamicImport("playwright-core")) as {
    chromium?: {
      launch: (options: Record<string, unknown>) => Promise<PlaywrightBrowser>;
    };
  };
  const chromium = imported.chromium;

  if (chromium === undefined) {
    throw new Error("playwright-core did not expose chromium");
  }

  const browser = await launchChromium(chromium);
  const consoleMessages: string[] = [];

  try {
    const page = await browser.newPage({
      viewport: viewportSize(input.viewport)
    });

    page.on("console", (message) => {
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });

    const response = await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: input.timeoutMs
    });
    const actionResults: StartupUiFlowActionResult[] = [];

    for (const action of input.flowActions) {
      actionResults.push(await runPlaywrightFlowAction(page, action, input.timeoutMs));
    }

    const html = await page.content();
    const screenshot = await page.screenshot({ fullPage: true });

    return {
      responseStatus: response?.status() ?? 0,
      responseOk: response === null ? false : response.ok(),
      html,
      screenshot,
      consoleMessages,
      actionResults
    };
  } finally {
    await browser.close();
  }
}

function isMissingPlaywrightError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Cannot find package 'playwright-core'|Cannot find module 'playwright-core'/i.test(
      error.message
    )
  );
}

async function launchChromium(chromium: {
  launch: (options: Record<string, unknown>) => Promise<PlaywrightBrowser>;
}): Promise<PlaywrightBrowser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function runPlaywrightFlowAction(
  page: PlaywrightPage,
  action: StartupUiFlowAction,
  timeoutMs: number
): Promise<StartupUiFlowActionResult> {
  try {
    switch (action.type) {
      case "fill": {
        const locator = await firstLocator(page, action);

        await locator.fill(action.value);
        return {
          type: action.type,
          status: "pass",
          summary: `filled ${locator.selector}`,
          selector: locator.selector,
          expected: action.value
        };
      }
      case "select": {
        const locator = await firstLocator(page, action);

        await locator.selectOption(action.value);
        return {
          type: action.type,
          status: "pass",
          summary: `selected ${action.value}`,
          selector: locator.selector,
          expected: action.value
        };
      }
      case "click": {
        const locator = await firstLocator(page, action);

        await locator.click();
        return {
          type: action.type,
          status: "pass",
          summary: `clicked ${locator.selector}`,
          selector: locator.selector
        };
      }
      case "expectText": {
        const text = await waitForPlaywrightText(page, action.text, timeoutMs);
        const found = text.includes(action.text);

        return {
          type: action.type,
          status: found ? "pass" : "fail",
          summary: found ? `found ${action.text}` : `missing ${action.text}`,
          expected: action.text
        };
      }
      case "expectCount": {
        const count = await page.locator(action.selector).count();

        return {
          type: action.type,
          status: count === action.count ? "pass" : "fail",
          summary: `expected ${action.count}, found ${count}`,
          selector: action.selector,
          expected: action.count,
          actual: count
        };
      }
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        return {
          type: action.type,
          status: "pass",
          summary: "reloaded page"
        };
      case "expectPersisted": {
        await page.reload({ waitUntil: "domcontentloaded" });
        const locator =
          action.selector !== undefined || action.selectors !== undefined
            ? await firstLocator(page, action)
            : page.locator("body");
        const text =
          action.selector !== undefined || action.selectors !== undefined
            ? await waitForPlaywrightLocatorText(locator, action.text, timeoutMs)
            : await waitForPlaywrightText(page, action.text, timeoutMs);
        const found = text.includes(action.text);
        const selector =
          "selector" in locator && typeof locator.selector === "string"
            ? locator.selector
            : undefined;

        return {
          type: action.type,
          status: found ? "pass" : "fail",
          summary: found
            ? `persisted ${action.text}`
            : `missing persisted ${action.text}`,
          ...(selector === undefined ? {} : { selector }),
          expected: action.text
        };
      }
    }
  } catch (error) {
    return {
      type: action.type,
      status: "fail",
      summary: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForPlaywrightText(
  page: PlaywrightPage,
  text: string,
  timeoutMs: number
): Promise<string> {
  return waitForText(() => page.locator("body").innerText(), text, timeoutMs);
}

async function waitForPlaywrightLocatorText(
  locator: PlaywrightLocator,
  text: string,
  timeoutMs: number
): Promise<string> {
  return waitForText(() => locator.innerText(), text, timeoutMs);
}

async function waitForText(
  readText: () => Promise<string>,
  text: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = "";

  while (Date.now() < deadline) {
    try {
      latest = await readText();
    } catch {
      latest = "";
    }

    if (latest.includes(text)) {
      return latest;
    }

    await sleep(100);
  }

  return latest;
}

async function firstLocator(
  page: PlaywrightPage,
  action: { selector?: string; selectors?: string[] }
): Promise<PlaywrightLocator & { selector: string }> {
  const selectors = [
    ...(action.selectors ?? []),
    ...(action.selector === undefined ? [] : [action.selector])
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) > 0) {
      return Object.assign(locator, { selector });
    }
  }

  throw new Error(`No matching selector found: ${selectors.join(", ")}`);
}

function viewportSize(viewport: string): { width: number; height: number } {
  const match = /^(?<width>\d+)x(?<height>\d+)$/i.exec(viewport.trim());

  if (match?.groups !== undefined) {
    return {
      width: Number(match.groups.width),
      height: Number(match.groups.height)
    };
  }

  return viewport === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 };
}

function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier) as Promise<unknown>;
}

async function runChromeDevtoolsBrowserFlow(
  input: StartupUiBrowserRunnerInput
): Promise<StartupUiBrowserRunnerResult> {
  const chromePath = await resolveChromeExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), "runstead-ui-chrome-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    {
      stdio: ["ignore", "ignore", "pipe"]
    }
  );
  const consoleMessages: string[] = [];

  try {
    const browserWsUrl = await waitForChromeDevtoolsUrl(child, input.timeoutMs);
    const connection = await CdpConnection.connect(browserWsUrl);

    try {
      const target = (await connection.command("Target.createTarget", {
        url: "about:blank"
      })) as { targetId: string };
      const attached = (await connection.command("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true
      })) as { sessionId: string };
      const sessionId = attached.sessionId;

      connection.onSessionEvent(sessionId, "Runtime.consoleAPICalled", (event) => {
        const params = isRecord(event.params) ? event.params : {};
        const args = Array.isArray(params.args) ? params.args : [];
        const text = args
          .map((arg) =>
            isRecord(arg) && typeof arg.value === "string" ? arg.value : undefined
          )
          .filter((item): item is string => item !== undefined)
          .join(" ");

        const messageType = typeof params.type === "string" ? params.type : "log";

        consoleMessages.push(`[${messageType}] ${text}`);
      });
      connection.onSessionEvent(sessionId, "Runtime.exceptionThrown", (event) => {
        consoleMessages.push(`[error] ${JSON.stringify(event.params ?? {})}`);
      });

      await connection.command("Runtime.enable", {}, sessionId);
      await connection.command("Page.enable", {}, sessionId);
      await connection.command(
        "Emulation.setDeviceMetricsOverride",
        {
          ...viewportSize(input.viewport),
          deviceScaleFactor: 1,
          mobile: input.viewport === "mobile"
        },
        sessionId
      );
      await connection.command("Page.navigate", { url: input.url }, sessionId);
      await waitForCdpPageReady(connection, sessionId, input.timeoutMs);

      const actionResults: StartupUiFlowActionResult[] = [];

      for (const action of input.flowActions) {
        actionResults.push(
          await runCdpFlowAction(connection, sessionId, action, input.timeoutMs)
        );
      }

      const html = await cdpEvaluateString(
        connection,
        sessionId,
        "document.documentElement.outerHTML",
        input.timeoutMs
      );
      const screenshotResult = (await connection.command(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: true },
        sessionId
      )) as { data?: string };

      return {
        responseStatus: 200,
        responseOk: html.trim().length > 0,
        html,
        ...(typeof screenshotResult.data === "string"
          ? { screenshot: Buffer.from(screenshotResult.data, "base64") }
          : {}),
        consoleMessages,
        actionResults
      };
    } finally {
      connection.close();
    }
  } finally {
    await cleanupChromeDevtoolsProfile(child, userDataDir, consoleMessages);
  }
}

async function cleanupChromeDevtoolsProfile(
  child: ChildProcess,
  userDataDir: string,
  consoleMessages: string[]
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }

  await waitForChildProcessExit(child, 1_000);

  try {
    await rm(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100
    });
  } catch (error) {
    consoleMessages.push(
      `[warn] failed to clean Chrome profile ${userDataDir}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function waitForChildProcessExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.off("close", done);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);

    child.once("close", done);
    child.once("exit", done);
  });
}

async function resolveChromeExecutable(): Promise<string> {
  const candidates = [
    process.env.RUNSTEAD_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((item): item is string => item !== undefined && item.length > 0);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "Interactive UI smoke requires playwright-core or a local Chrome/Chromium executable. Set RUNSTEAD_CHROME_PATH to the browser binary."
  );
}

function waitForChromeDevtoolsUrl(
  child: ChildProcess,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    if (child.stderr === null) {
      reject(new Error("Chrome stderr was not available for DevTools startup"));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Chrome DevTools websocket URL"));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk.toString("utf8"));

      if (match?.[1] !== undefined) {
        cleanup();
        resolveUrl(match[1]);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error("Chrome exited before exposing DevTools websocket URL"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

async function waitForCdpPageReady(
  connection: CdpConnection,
  sessionId: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await cdpEvaluateString(
      connection,
      sessionId,
      "document.readyState",
      timeoutMs
    );

    if (state === "interactive" || state === "complete") {
      return;
    }

    await sleep(100);
  }

  throw new Error("Timed out waiting for browser page readiness");
}

async function waitForCdpText(
  connection: CdpConnection,
  sessionId: string,
  text: string,
  timeoutMs: number
): Promise<string> {
  return waitForText(
    () =>
      cdpEvaluateString(
        connection,
        sessionId,
        'document.body ? document.body.innerText || document.body.textContent || "" : ""',
        timeoutMs
      ),
    text,
    timeoutMs
  );
}

async function runCdpFlowAction(
  connection: CdpConnection,
  sessionId: string,
  action: StartupUiFlowAction,
  timeoutMs: number
): Promise<StartupUiFlowActionResult> {
  try {
    if (action.type === "reload") {
      await connection.command("Page.reload", {}, sessionId);
      await waitForCdpPageReady(connection, sessionId, timeoutMs);

      return {
        type: action.type,
        status: "pass",
        summary: "reloaded page"
      };
    }

    if (action.type === "expectPersisted") {
      await connection.command("Page.reload", {}, sessionId);
      await waitForCdpPageReady(connection, sessionId, timeoutMs);
    }

    if (action.type === "expectText" || action.type === "expectPersisted") {
      const text = await waitForCdpText(connection, sessionId, action.text, timeoutMs);
      const found = text.includes(action.text);

      return {
        type: action.type,
        status: found ? "pass" : "fail",
        summary: found
          ? action.type === "expectText"
            ? `found ${action.text}`
            : `persisted ${action.text}`
          : action.type === "expectText"
            ? `missing ${action.text}`
            : `missing persisted ${action.text}`,
        expected: action.text
      };
    }

    const result = (await cdpEvaluateJson(
      connection,
      sessionId,
      cdpFlowActionExpression(action),
      timeoutMs
    )) as StartupUiFlowActionResult;

    return result.status === "pass" || result.status === "fail"
      ? result
      : {
          type: action.type,
          status: "fail",
          summary: "flow action returned an invalid status"
        };
  } catch (error) {
    return {
      type: action.type,
      status: "fail",
      summary: error instanceof Error ? error.message : String(error)
    };
  }
}

function cdpFlowActionExpression(action: StartupUiFlowAction): string {
  return `
(() => {
  const action = ${JSON.stringify(action)};
  const selectors = [...(action.selectors || []), ...(action.selector ? [action.selector] : [])];
  const bySelector = (selector) => {
    if (selector.startsWith("text=")) {
      const needle = selector.slice(5);
      return [...document.querySelectorAll("body *")].find((node) => (node.innerText || node.textContent || "").includes(needle));
    }
    const hasText = selector.match(/^(.+):has-text\\(["'](.+)["']\\)$/);
    if (hasText) {
      return [...document.querySelectorAll(hasText[1])].find((node) => (node.innerText || node.textContent || "").includes(hasText[2]));
    }
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  };
  const first = () => {
    for (const selector of selectors) {
      const node = bySelector(selector);
      if (node) return { node, selector };
    }
    return null;
  };
  const bodyText = () => document.body ? document.body.innerText || document.body.textContent || "" : "";
  const pass = (summary, extra = {}) => ({ type: action.type, status: "pass", summary, ...extra });
  const fail = (summary, extra = {}) => ({ type: action.type, status: "fail", summary, ...extra });

  if (action.type === "fill") {
    const found = first();
    if (!found) return fail("No matching selector found", { expected: action.value });
    found.node.focus();
    found.node.value = action.value;
    found.node.dispatchEvent(new Event("input", { bubbles: true }));
    found.node.dispatchEvent(new Event("change", { bubbles: true }));
    return pass("filled " + found.selector, { selector: found.selector, expected: action.value });
  }
  if (action.type === "select") {
    const found = first();
    if (!found) return fail("No matching selector found", { expected: action.value });
    found.node.value = action.value;
    found.node.dispatchEvent(new Event("change", { bubbles: true }));
    return pass("selected " + action.value, { selector: found.selector, expected: action.value });
  }
  if (action.type === "click") {
    const found = first();
    if (!found) return fail("No matching selector found");
    found.node.click();
    return pass("clicked " + found.selector, { selector: found.selector });
  }
  if (action.type === "expectText") {
    const found = bodyText().includes(action.text);
    return found ? pass("found " + action.text, { expected: action.text }) : fail("missing " + action.text, { expected: action.text });
  }
  if (action.type === "expectCount") {
    const actual = document.querySelectorAll(action.selector).length;
    return actual === action.count ? pass("expected " + action.count + ", found " + actual, { selector: action.selector, expected: action.count, actual }) : fail("expected " + action.count + ", found " + actual, { selector: action.selector, expected: action.count, actual });
  }
  if (action.type === "reload") {
    return pass("reload requested");
  }
  if (action.type === "expectPersisted") {
    const found = bodyText().includes(action.text);
    return found ? pass("persisted " + action.text, { expected: action.text }) : fail("missing persisted " + action.text, { expected: action.text });
  }
  return fail("Unsupported action type: " + action.type);
})()
`;
}

async function cdpEvaluateString(
  connection: CdpConnection,
  sessionId: string,
  expression: string,
  timeoutMs: number
): Promise<string> {
  const value = await cdpEvaluateJson(connection, sessionId, expression, timeoutMs);

  return typeof value === "string" ? value : "";
}

async function cdpEvaluateJson(
  connection: CdpConnection,
  sessionId: string,
  expression: string,
  timeoutMs: number
): Promise<unknown> {
  const result = (await connection.command(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs
    },
    sessionId
  )) as { result?: { value?: unknown; description?: string } };

  return result.result?.value ?? result.result?.description;
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly handlers = new Map<string, ((event: CdpEvent) => void)[]>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Chrome DevTools websocket closed"));
      }

      this.pending.clear();
    });
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolveConnection, reject) => {
      const socket = new WebSocket(url);
      const onOpen = () => {
        cleanup();
        resolveConnection(new CdpConnection(socket));
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to connect to Chrome DevTools websocket"));
      };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId })
    };

    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  onSessionEvent(
    sessionId: string,
    method: string,
    handler: (event: CdpEvent) => void
  ): void {
    const key = `${sessionId}:${method}`;
    const handlers = this.handlers.get(key) ?? [];

    handlers.push(handler);
    this.handlers.set(key, handlers);
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(data: unknown): void {
    const message = JSON.parse(String(data)) as CdpMessage;

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);

      if (pending === undefined) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (message.method !== undefined && message.sessionId !== undefined) {
      const handlers =
        this.handlers.get(`${message.sessionId}:${message.method}`) ?? [];

      for (const handler of handlers) {
        handler(message as CdpEvent);
      }
    }
  }
}

interface CdpMessage {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    message: string;
  };
}

interface CdpEvent extends CdpMessage {
  sessionId: string;
  method: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

interface PlaywrightBrowser {
  newPage(options: {
    viewport: { width: number; height: number };
  }): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  on(event: "console", handler: (message: PlaywrightConsoleMessage) => void): void;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number }
  ): Promise<PlaywrightResponse | null>;
  locator(selector: string): PlaywrightLocator;
  content(): Promise<string>;
  screenshot(options: { fullPage: boolean }): Promise<Buffer>;
  reload(options: { waitUntil: "domcontentloaded" }): Promise<void>;
}

interface PlaywrightLocator {
  first(): PlaywrightLocator;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<void>;
  click(): Promise<void>;
  innerText(): Promise<string>;
}

interface PlaywrightResponse {
  status(): number;
  ok(): boolean;
}

interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
}

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

function executedDomStatus(
  response: Response,
  html: string,
  expectedText: StartupUiValidationTextCheck[]
): StartupUiValidationStatus {
  return response.ok &&
    html.trim().length > 0 &&
    expectedText.every((item) => item.found)
    ? "pass"
    : "fail";
}

function executedAccessibilityStatus(html: string): StartupUiValidationStatus {
  const hasLandmark = /<main[\s>]|role=["']main["']|<h1[\s>]/i.test(html);
  const hasLabelSignal =
    /<title[\s>]|aria-label=|<label[\s>]|alt=|<button[\s>][^<]+/i.test(html);

  return hasLandmark && hasLabelSignal ? "pass" : "fail";
}

function executedResponsiveStatus(viewport: string): StartupUiValidationStatus {
  return viewport.trim().length > 0 ? "pass" : "fail";
}

export function parseStartupUiValidationStatus(
  value: string
): StartupUiValidationStatus {
  if (value === "pass" || value === "fail" || value === "not_run") {
    return value;
  }

  throw new Error("UI validation status must be one of: pass, fail, not_run");
}

function uiValidationFailed(input: {
  domStatus: StartupUiValidationStatus;
  accessibilityStatus: StartupUiValidationStatus;
  responsiveStatus: StartupUiValidationStatus;
  criticalFlowStatus: StartupUiValidationStatus;
}): boolean {
  return [
    input.domStatus,
    input.accessibilityStatus,
    input.responsiveStatus,
    input.criticalFlowStatus
  ].includes("fail");
}
