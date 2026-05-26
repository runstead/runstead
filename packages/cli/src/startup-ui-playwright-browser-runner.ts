import type {
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult,
  StartupUiFlowAction,
  StartupUiFlowActionResult
} from "./startup-ui-validation-types.js";
import {
  dynamicImport,
  viewportSize,
  waitForText
} from "./startup-ui-browser-runner-utils.js";
import { expectPlaywrightNoOverlap } from "./startup-ui-playwright-overlap.js";

export async function runPlaywrightBrowserFlow(
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

export function isMissingPlaywrightError(error: unknown): boolean {
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
