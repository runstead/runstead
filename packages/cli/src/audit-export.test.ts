import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { exportAuditLog } from "./audit-export.js";
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
});
