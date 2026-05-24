import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { startupOnboard } from "./startup-founder-flow.js";
import { formatStartupStatus, getStartupStatus } from "./startup-status.js";
import { claimTask, showTask } from "./tasks.js";

describe("startup status", () => {
  it("summarizes founder gates, evidence freshness, blockers, and next action", async () => {
    const workspace = join(tmpdir(), `runstead-startup-status-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-status-fixture",
            private: true,
            scripts: {
              test: "node -e \"console.log('test ok')\""
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "metric_snapshot",
        summary: "Activation snapshot is stale",
        sources: [
          {
            uri: "posthog:activation",
            kind: "posthog",
            capturedAt: "2026-04-01T00:00:00.000Z",
            freshnessDays: 7
          }
        ],
        content: JSON.stringify({
          source: "posthog",
          threshold: "0.4",
          current: "0.5"
        }),
        now: new Date("2026-05-14T00:05:00.000Z")
      });

      const status = await getStartupStatus({
        cwd: workspace,
        now: new Date("2026-05-14T00:10:00.000Z")
      });

      expect(status.currentStage).toBe("mvp");
      expect(status.gates).toHaveLength(3);
      expect(status.gates.find((gate) => gate.stage === "launch")).toMatchObject({
        status: "blocked"
      });
      expect(status.evidence.total).toBeGreaterThan(0);
      expect(status.evidence.sourceKinds).toContain("posthog");
      expect(status.evidence.staleSources).toEqual([
        expect.objectContaining({
          uri: "posthog:activation",
          freshnessDays: 7
        })
      ]);
      expect(status.nextAction.command).toBe("runstead startup gate check --stage mvp");
      expect(formatStartupStatus(status)).toContain("Startup status");
      expect(formatStartupStatus(status)).toContain("Top blockers:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses the latest startup ready verdict to avoid stale gate status conflicts", async () => {
    const workspace = join(tmpdir(), `runstead-startup-status-ready-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const onboard = await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      await mkdir(join(onboard.root, "startup", "readiness-runs"), {
        recursive: true
      });
      await writeFile(
        join(onboard.root, "startup", "readiness-runs", "run_ready.json"),
        `${JSON.stringify(
          {
            id: "run_ready",
            target: "local",
            verdict: "local_launch_ready",
            verdictBlockers: [],
            completedAt: "2026-05-14T01:00:00.000Z"
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const database = openRunsteadDatabase(join(onboard.root, "state.db"));

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_startup_status_running_snapshot",
            type: "startup_readiness.run_snapshot",
            aggregateType: "startup_readiness_run",
            aggregateId: "run_running",
            payload: {
              runId: "run_running",
              target: "local",
              status: "running",
              verdict: "local_launch_blocked",
              verdictBlockers: ["new run still in progress"]
            },
            createdAt: "2026-05-14T01:04:00.000Z"
          }
        });
      } finally {
        database.close();
      }

      const status = await getStartupStatus({
        cwd: workspace,
        now: new Date("2026-05-14T01:05:00.000Z")
      });
      const formatted = formatStartupStatus(status);

      expect(status.currentStage).toBe("launch");
      expect(status.readiness).toMatchObject({
        runId: "run_ready",
        verdict: "local_launch_ready"
      });
      expect(status.nextAction.reason).toContain("local_launch_ready");
      expect(formatted).toContain("Readiness verdict: local_launch_ready");
      expect(formatted).toContain("Top blockers:\n- none");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("recovers stale running tasks before reporting status", async () => {
    const workspace = join(tmpdir(), `runstead-startup-status-stale-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T02:01:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T02:02:00.000Z")
      });
      const database = openRunsteadDatabase(goal.stateDb);

      try {
        database
          .prepare("UPDATE tasks SET owner_id = ? WHERE id = ?")
          .run("pid:999999999", task.id);
      } finally {
        database.close();
      }

      const status = await getStartupStatus({
        cwd: workspace,
        now: new Date("2026-05-14T02:40:00.000Z")
      });
      const stored = showTask({ cwd: workspace, id: task.id }).task;
      const formatted = formatStartupStatus(status);

      expect(status.execution.recoveredTasks).toMatchObject([
        {
          id: task.id,
          previousStatus: "claimed",
          status: "queued"
        }
      ]);
      expect(status.execution.interruptedTasks).toEqual([]);
      expect(stored.status).toBe("queued");
      expect(formatted).toContain("Recovered stale tasks: 1");
      expect(formatted).toContain("Active interrupted tasks: 0");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
