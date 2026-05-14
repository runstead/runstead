import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { exportAuditLog, formatAuditTimeline } from "./audit-export.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";

describe("exportAuditLog", () => {
  it("exports events as ordered JSONL", async () => {
    const workspace = join(tmpdir(), `runstead-audit-export-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:00:00.000Z")
      });

      const outputPath = join(workspace, "audit", "events.jsonl");
      const result = await exportAuditLog({
        cwd: workspace,
        outputPath
      });
      const written = await readFile(outputPath, "utf8");
      const lines = written.trim().split("\n");
      const first = JSON.parse(lines[0] ?? "{}") as {
        id: number;
        eventId: string;
        type: string;
        payload: unknown;
      };

      expect(result.outputPath).toBe(outputPath);
      expect(result.contents).toBe(written);
      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      expect(lines).toHaveLength(result.entries.length);
      expect(first).toMatchObject({
        id: 1,
        type: "evidence.recorded"
      });
      expect(result.entries.map((entry) => entry.type)).toContain("goal.created");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("filters exported events by type and aggregate", async () => {
    const workspace = join(tmpdir(), `runstead-audit-export-filter-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:30:00.000Z")
      });

      const byType = await exportAuditLog({
        cwd: workspace,
        types: ["goal.created"]
      });
      const byAggregate = await exportAuditLog({
        cwd: workspace,
        aggregateType: "goal",
        aggregateId: created.goal.id
      });

      expect(byType.entries.map((entry) => entry.type)).toEqual(["goal.created"]);
      expect(byAggregate.entries).toHaveLength(1);
      expect(byAggregate.entries[0]).toMatchObject({
        type: "goal.created",
        aggregateType: "goal",
        aggregateId: created.goal.id
      });
      expect(byAggregate.contents.trim()).toBe(JSON.stringify(byAggregate.entries[0]));
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("formats filtered events as a replayable timeline", async () => {
    const workspace = join(tmpdir(), `runstead-audit-timeline-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });

      const result = await exportAuditLog({
        cwd: workspace,
        aggregateType: "goal",
        aggregateId: created.goal.id
      });
      const timeline = formatAuditTimeline(result.entries);

      expect(timeline).toContain("goal.created");
      expect(timeline).toContain(`goal:${created.goal.id}`);
      expect(timeline).toContain("2026-05-14T08:00:00.000Z");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
