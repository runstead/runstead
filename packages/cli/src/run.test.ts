import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { runOnce } from "./run.js";

describe("runOnce", () => {
  it("returns no queued task when none exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      expect(runOnce({ cwd: workspace })).toEqual({
        cwd: workspace,
        ranTask: false,
        reason: "no_queued_task"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("selects the next queued task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      expect(runOnce({ cwd: workspace })).toMatchObject({
        cwd: workspace,
        ranTask: false,
        reason: "task_selected",
        task: {
          id: task.id,
          status: "queued"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
