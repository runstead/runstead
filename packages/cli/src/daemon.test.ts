import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireManagerLock, type Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  formatDaemonReport,
  formatDaemonStatus,
  readDaemonStatus,
  runDaemon,
  type DaemonRunner,
  type DaemonScheduler
} from "./daemon.js";
import { initRunstead } from "./init.js";
import type { RunCiRepairOrchestratorResult } from "./ci-repair-orchestrator.js";

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

  it("records daemon ticks when audit is enabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-daemon-audit-"));
    const scheduler: DaemonScheduler = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        stateDb: join(workspace, ".runstead", "state.db"),
        scheduledTasks: [],
        skippedTasks: []
      });
    const runner: DaemonRunner = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        ranTask: false,
        reason: "no_queued_task"
      });

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const result = await runDaemon({
        cwd: workspace,
        intervalMs: 0,
        maxTicks: 1,
        scheduler,
        runner,
        audit: true,
        now: new Date("2026-05-14T09:00:00.000Z")
      });
      const event = result.ticks[0]?.event;

      if (event === undefined) {
        throw new Error("Expected daemon tick audit event");
      }

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const row = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE event_id = ?
          `
          )
          .get(event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

        expect(row).toMatchObject({
          type: "daemon.tick",
          aggregate_type: "daemon",
          aggregate_id: workspace,
          created_at: "2026-05-14T09:00:00.000Z"
        });
        expect(JSON.parse(row.payload_json)).toMatchObject({
          tick: 1,
          scheduledTasks: 0,
          skippedTasks: 0,
          ranTask: false,
          reason: "no_queued_task"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("writes daemon heartbeat status when enabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-daemon-heartbeat-"));
    const scheduler: DaemonScheduler = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        stateDb: join(workspace, ".runstead", "state.db"),
        scheduledTasks: [],
        skippedTasks: []
      });
    const runner: DaemonRunner = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        ranTask: false,
        reason: "no_queued_task"
      });

    try {
      await initRunstead({ cwd: workspace });
      const result = await runDaemon({
        cwd: workspace,
        intervalMs: 0,
        maxTicks: 1,
        scheduler,
        runner,
        heartbeat: true,
        now: new Date("2026-05-14T09:05:00.000Z")
      });
      const status = await readDaemonStatus({ cwd: workspace });

      expect(result.ticks[0]?.heartbeat).toMatchObject({
        cwd: workspace,
        tick: 1,
        intervalMs: 0,
        updatedAt: "2026-05-14T09:05:00.000Z",
        scheduledTasks: 0,
        skippedTasks: 0,
        ranTask: false,
        reason: "no_queued_task"
      });
      expect(status).toMatchObject(result.ticks[0]?.heartbeat ?? {});
      expect(formatDaemonStatus(status)).toContain(
        "Last result: idle (no_queued_task)"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("marks stale daemon heartbeat status", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-daemon-stale-"));
    const scheduler: DaemonScheduler = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        stateDb: join(workspace, ".runstead", "state.db"),
        scheduledTasks: [],
        skippedTasks: []
      });
    const runner: DaemonRunner = (options) =>
      Promise.resolve({
        cwd: options.cwd ?? "",
        ranTask: false,
        reason: "no_queued_task"
      });

    try {
      await initRunstead({ cwd: workspace });
      await runDaemon({
        cwd: workspace,
        intervalMs: 0,
        maxTicks: 1,
        scheduler,
        runner,
        heartbeat: true,
        now: new Date("2026-05-14T09:10:00.000Z")
      });

      const status = await readDaemonStatus({
        cwd: workspace,
        staleAfterMs: 1_000,
        now: new Date("2026-05-14T09:10:02.000Z")
      });

      expect(status).toMatchObject({
        stale: true,
        ageMs: 2_000
      });
      expect(formatDaemonStatus(status)).toContain("Health: stale age=2000ms");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("includes ci repair orchestration details in the report", () => {
    const report = formatDaemonReport({
      cwd: "/repo",
      intervalMs: 0,
      stoppedReason: "max_ticks",
      ticks: [
        {
          tick: 1,
          scheduled: {
            cwd: "/repo",
            stateDb: "/repo/.runstead/state.db",
            scheduledTasks: [],
            skippedTasks: []
          },
          result: {
            cwd: "/repo",
            ranTask: true,
            task: fakeTask({
              id: "task_ci_repair_123",
              type: "ci_repair",
              status: "waiting_approval"
            }),
            ciRepairResult: fakeCiRepairResult({
              status: "waiting_approval",
              branchName: "runstead/task_ci_repair_123/ci-456",
              approvalId: "approval_push_123"
            })
          }
        },
        {
          tick: 2,
          result: {
            cwd: "/repo",
            ranTask: true,
            task: fakeTask({
              id: "task_ci_repair_124",
              type: "ci_repair",
              status: "completed"
            }),
            ciRepairResult: fakeCiRepairResult({
              status: "completed",
              branchName: "runstead/task_ci_repair_124/ci-789",
              pullRequestUrl: "https://github.example/acme/repo/pull/42"
            })
          }
        }
      ]
    });

    expect(report).toContain(
      "tick 1: scheduled=0 ran task_ci_repair_123 type=ci_repair status=waiting_approval"
    );
    expect(report).toContain("ci_repair=waiting_approval");
    expect(report).toContain("branch=runstead/task_ci_repair_123/ci-456");
    expect(report).toContain("approval=approval_push_123");
    expect(report).toContain("ci_repair=completed");
    expect(report).toContain("pr=https://github.example/acme/repo/pull/42");
  });

  it("refuses default daemon ticks while another manager holds the workspace lock", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-daemon-lock-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const lock = await acquireManagerLock({
        lockPath: join(initialized.root, "manager.lock"),
        ownerId: "test-manager"
      });

      try {
        await expect(
          runDaemon({
            cwd: workspace,
            intervalMs: 0,
            maxTicks: 1
          })
        ).rejects.toThrow("Runstead manager lock is already held");
      } finally {
        await lock.release();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function fakeTask(input: { id: string; type: string; status: Task["status"] }): Task {
  return {
    id: input.id,
    goalId: "goal_keep_ci_green",
    domain: "repo-maintenance",
    type: input.type,
    status: input.status,
    priority: "high",
    attempt: 0,
    maxAttempts: 1,
    input: {},
    verifiers: [],
    createdAt: "2026-05-14T08:00:00.000Z",
    updatedAt: "2026-05-14T08:00:00.000Z"
  };
}

function fakeCiRepairResult(input: {
  status: RunCiRepairOrchestratorResult["status"];
  branchName: string;
  approvalId?: string;
  pullRequestUrl?: string;
}): RunCiRepairOrchestratorResult {
  return {
    status: input.status,
    ciRepair: {} as RunCiRepairOrchestratorResult["ciRepair"],
    branchName: input.branchName,
    ...(input.approvalId === undefined
      ? {}
      : {
          approval: {
            id: input.approvalId,
            actionId: "act_push",
            policyDecisionId: "pdec_push",
            reason: "External branch push requires approval"
          }
        }),
    ...(input.pullRequestUrl === undefined
      ? {}
      : {
          pullRequest: {
            cwd: "/repo",
            title: "Fix CI",
            base: "main",
            head: input.branchName,
            stdout: "",
            url: input.pullRequestUrl
          }
        })
  };
}
