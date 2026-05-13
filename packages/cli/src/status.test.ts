import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { getRunsteadStatus } from "./status.js";

describe("getRunsteadStatus", () => {
  it("returns uninitialized status when config is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-status-"));

    try {
      const status = await getRunsteadStatus(workspace);

      expect(status).toEqual({
        initialized: false,
        root: join(workspace, ".runstead")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reads goals, task counts, and evidence from SQLite", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-status-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T04:00:00.000Z")
      });

      const status = await getRunsteadStatus(workspace);

      expect(status.initialized).toBe(true);
      expect(status.domain).toBe("repo-maintenance");
      expect(status.goals).toEqual([
        {
          id: goal.goal.id,
          title: "Keep repository CI green",
          status: "active",
          priority: "medium"
        }
      ]);
      expect(status.tasks).toEqual({
        total: 1,
        byStatus: {
          queued: 1
        }
      });
      expect(status.latestEvidence).toMatchObject({
        type: "repo_inspection"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
