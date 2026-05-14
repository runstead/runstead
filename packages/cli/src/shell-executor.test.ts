import { describe, expect, it } from "vitest";

import { runShellCommand } from "./shell-executor.js";

describe("runShellCommand", () => {
  it("runs a successful shell command", async () => {
    const result = await runShellCommand({
      command: nodeCommand("process.exit(0)")
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("returns the exit code from a failing command", async () => {
    const result = await runShellCommand({
      command: nodeCommand("process.exit(7)")
    });

    expect(result.exitCode).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it("marks commands that exceed the timeout", async () => {
    const result = await runShellCommand({
      command: nodeCommand("setTimeout(() => {}, 1000)"),
      timeoutMs: 50
    });

    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(result.forceKilled).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "force kills timed out commands that ignore termination",
    async () => {
      const result = await runShellCommand({
        command: `exec ${nodeCommand(
          "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
        )}`,
        timeoutMs: 1_000,
        killGraceMs: 25
      });

      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBe(true);
      expect(result.forceKilled).toBe(true);
    }
  );

  it("does not force kill commands that exit during the grace period", async () => {
    const result = await runShellCommand({
      command: nodeCommand(
        "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"
      ),
      timeoutMs: 100,
      killGraceMs: 100
    });

    expect(result.timedOut).toBe(true);
    expect(result.forceKilled).toBe(false);
  });

  it("rejects non-positive kill grace values", async () => {
    await expect(
      runShellCommand({
        command: nodeCommand("process.exit(0)"),
        killGraceMs: 0
      })
    ).rejects.toThrow("killGraceMs must be greater than 0");
  });

  it("captures stdout and stderr", async () => {
    const result = await runShellCommand({
      command: nodeCommand("console.log('stdout line'); console.error('stderr line');")
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("stdout line\n");
    expect(result.stderr).toBe("stderr line\n");
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(false);
  });

  it("truncates captured output at the configured byte limit", async () => {
    const result = await runShellCommand({
      command: nodeCommand("process.stdout.write('abcdef');"),
      maxOutputBytes: 4
    });

    expect(result.stdout).toBe("abcd");
    expect(result.stdoutTruncated).toBe(true);
  });

  it("redacts sensitive environment values from command output", async () => {
    const result = await runShellCommand({
      command: nodeCommand(
        "console.log(process.env.RUNSTEAD_TEST_TOKEN); console.error(process.env.RUNSTEAD_TEST_TOKEN);"
      ),
      env: {
        RUNSTEAD_TEST_TOKEN: "secret-token-value"
      }
    });

    expect(result.stdout).toBe("[REDACTED]\n");
    expect(result.stderr).toBe("[REDACTED]\n");
  });

  it("redacts explicit values from the reported command", async () => {
    const result = await runShellCommand({
      command: nodeCommand("process.exit(0)") + " # command-secret-value",
      redactValues: ["command-secret-value"]
    });

    expect(result.command).toContain("[REDACTED]");
    expect(result.command).not.toContain("command-secret-value");
  });
});

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}
