import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { findInterruptedTasks, resumeInterruptedTasks } from "./resume.js";
import { claimTask, showTask } from "./tasks.js";

describe("findInterruptedTasks", () => {
  it("detects claimed tasks as interrupted", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-resume-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T07:01:00.000Z")
      });

      const result = findInterruptedTasks({ cwd: workspace });

      expect(result.interruptedTasks).toMatchObject([
        {
          task: {
            id: task.id,
            status: "claimed"
          },
          reason: "claimed_or_running"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requeues interrupted tasks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-resume-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:10:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T07:11:00.000Z")
      });

      const result = resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-14T07:12:00.000Z")
      });
      const stored = showTask({ cwd: workspace, id: task.id }).task;

      expect(result.requeuedTasks).toHaveLength(1);
      expect(result.requeuedTasks[0]).toMatchObject({
        task: {
          id: task.id,
          status: "queued",
          updatedAt: "2026-05-14T07:12:00.000Z"
        },
        previousStatus: "claimed"
      });
      expect(stored.status).toBe("queued");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
