import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { findInterruptedTasks } from "./resume.js";
import { claimTask } from "./tasks.js";

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
});
