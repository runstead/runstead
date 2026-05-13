import { describe, expect, it } from "vitest";

import { formatDaemonReport, runDaemon, type DaemonRunner } from "./daemon.js";

describe("runDaemon", () => {
  it("runs bounded daemon ticks through an injectable runner", async () => {
    const calls: string[] = [];
    const runner: DaemonRunner = (options) => {
      calls.push(options.cwd ?? "");

      return Promise.resolve({
        cwd: options.cwd ?? "",
        ranTask: false,
        reason: "no_queued_task"
      });
    };

    const result = await runDaemon({
      cwd: "/repo",
      intervalMs: 0,
      maxTicks: 2,
      runner
    });

    expect(calls).toEqual(["/repo", "/repo"]);
    expect(result.ticks).toHaveLength(2);
    expect(result.stoppedReason).toBe("max_ticks");
    expect(formatDaemonReport(result)).toContain("tick 1: idle");
  });

  it("rejects invalid max tick counts", async () => {
    await expect(
      runDaemon({
        maxTicks: 0
      })
    ).rejects.toThrow("maxTicks");
  });
});
