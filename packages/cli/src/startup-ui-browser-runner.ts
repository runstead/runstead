import type {
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult
} from "./startup-ui-validation.js";
import { runChromeDevtoolsBrowserFlow } from "./startup-ui-cdp-browser-runner.js";
import {
  isMissingPlaywrightError,
  runPlaywrightBrowserFlow
} from "./startup-ui-playwright-browser-runner.js";

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
