import type { ChildProcess } from "node:child_process";
import { access, rm } from "node:fs/promises";

export async function cleanupChromeDevtoolsProfile(
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

export async function resolveChromeExecutable(): Promise<string> {
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

export function waitForChromeDevtoolsUrl(
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
