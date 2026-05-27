import type {
  StartupUiFlowAction,
  StartupUiFlowActionResult
} from "./startup-ui-validation-types.js";
import { waitForText } from "./startup-ui-browser-runner-utils.js";
import { expectPlaywrightNoOverlap } from "./startup-ui-playwright-overlap.js";
import type {
  PlaywrightLocator,
  PlaywrightPage
} from "./startup-ui-playwright-types.js";

export async function runPlaywrightFlowAction(
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
