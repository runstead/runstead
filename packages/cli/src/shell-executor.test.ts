import { describe, expect, it } from "vitest";

import { runShellCommand } from "./shell-executor.js";

describe("runShellCommand", () => {
  it("runs a successful shell command", async () => {
    const result = await runShellCommand({
      command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
  });

  it("returns the exit code from a failing command", async () => {
    const result = await runShellCommand({
      command: `${JSON.stringify(process.execPath)} -e "process.exit(7)"`
    });

    expect(result.exitCode).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it("marks commands that exceed the timeout", async () => {
    const result = await runShellCommand({
      command: `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 1000)"`,
      timeoutMs: 50
    });

    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
  });
});
