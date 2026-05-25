import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult,
  StartupUiFlowAction,
  StartupUiFlowActionResult
} from "./startup-ui-validation.js";
import { CdpConnection } from "./startup-ui-cdp-connection.js";

export async function defaultStartupUiBrowserRunner(
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
      case "expectNoOverlap": {
        const result = await expectPlaywrightNoOverlap(page, action.selectors);

        return {
          type: action.type,
          status: result.overlap === undefined ? "pass" : "fail",
          summary:
            result.overlap === undefined
              ? `no overlap across ${result.count} visible controls`
              : `overlap between ${result.overlap.first} and ${result.overlap.second}`,
          expected: "no-overlap",
          actual:
            result.overlap === undefined
              ? `${result.count} visible controls`
              : result.overlap.area
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

interface StartupUiElementBox {
  selector: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface StartupUiOverlapResult {
  count: number;
  overlap?: {
    first: string;
    second: string;
    area: string;
  };
}

async function expectPlaywrightNoOverlap(
  page: PlaywrightPage,
  selectors: string[]
): Promise<StartupUiOverlapResult> {
  const boxes: StartupUiElementBox[] = [];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) === 0) {
      continue;
    }

    const box = await locator.boundingBox();

    if (box === null || box.width <= 0 || box.height <= 0) {
      continue;
    }

    boxes.push({
      selector,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height
    });
  }

  return findStartupUiOverlap(boxes);
}

function findStartupUiOverlap(boxes: StartupUiElementBox[]): StartupUiOverlapResult {
  for (let index = 0; index < boxes.length; index += 1) {
    for (let next = index + 1; next < boxes.length; next += 1) {
      const first = boxes[index];
      const second = boxes[next];

      if (first === undefined || second === undefined) {
        continue;
      }

      const width =
        Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const height =
        Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

      if (width > 1 && height > 1) {
        return {
          count: boxes.length,
          overlap: {
            first: first.selector,
            second: second.selector,
            area: `${Math.round(width)}x${Math.round(height)}`
          }
        };
      }
    }
  }

  return { count: boxes.length };
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
  if (action.type === "expectNoOverlap") {
    const boxes = selectors
      .map((selector) => {
        const node = bySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          selector,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      })
      .filter(Boolean);
    for (let index = 0; index < boxes.length; index += 1) {
      for (let next = index + 1; next < boxes.length; next += 1) {
        const first = boxes[index];
        const second = boxes[next];
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (width > 1 && height > 1) {
          return fail("overlap between " + first.selector + " and " + second.selector, { expected: "no-overlap", actual: Math.round(width) + "x" + Math.round(height) });
        }
      }
    }
    return pass("no overlap across " + boxes.length + " visible controls", { expected: "no-overlap", actual: boxes.length + " visible controls" });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
}

interface PlaywrightResponse {
  status(): number;
  ok(): boolean;
}

interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
}
