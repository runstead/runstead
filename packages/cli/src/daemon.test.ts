import { describe, expect, it } from "vitest";

import {
  formatDaemonReport,
  runDaemon,
  type DaemonRunner,
  type DaemonScheduler
} from "./daemon.js";

describe("runDaemon", () => {
  it("runs bounded daemon ticks through injectable scheduler and runner", async () => {
    const calls: string[] = [];
    const scheduler: DaemonScheduler = (options) => {
      calls.push(`schedule:${options.cwd ?? ""}`);

      return Promise.resolve({
        cwd: options.cwd ?? "",
        stateDb: "/repo/.runstead/state.db",
        scheduledTasks: [],
        skippedTasks: []
      });
    };
    const runner: DaemonRunner = (options) => {
      calls.push(`run:${options.cwd ?? ""}`);

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
      scheduler,
      runner
    });

    expect(calls).toEqual([
      "schedule:/repo",
      "run:/repo",
      "schedule:/repo",
      "run:/repo"
    ]);
    expect(result.ticks).toHaveLength(2);
    expect(result.stoppedReason).toBe("max_ticks");
    expect(formatDaemonReport(result)).toContain("tick 1: scheduled=0 idle");
  });

  it("rejects invalid max tick counts", async () => {
    await expect(
      runDaemon({
        maxTicks: 0
      })
    ).rejects.toThrow("maxTicks");
  });
});
