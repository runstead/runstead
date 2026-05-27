import type {
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult,
  StartupUiFlowActionResult
} from "./startup-ui-validation-types.js";
import { dynamicImport, viewportSize } from "./startup-ui-browser-runner-utils.js";
import { runPlaywrightFlowAction } from "./startup-ui-playwright-flow-action.js";
import type { PlaywrightBrowser } from "./startup-ui-playwright-types.js";

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
