import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  StartupUiBrowserRunnerInput,
  StartupUiBrowserRunnerResult,
  StartupUiFlowAction,
  StartupUiFlowActionResult
} from "./startup-ui-validation.js";
import {
  cleanupChromeDevtoolsProfile,
  resolveChromeExecutable,
  waitForChromeDevtoolsUrl
} from "./startup-ui-chrome-devtools.js";
import { CdpConnection } from "./startup-ui-cdp-connection.js";
import { cdpFlowActionExpression } from "./startup-ui-cdp-flow-action.js";
import {
  isRecord,
  sleep,
  viewportSize,
  waitForText
} from "./startup-ui-browser-runner-utils.js";
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
