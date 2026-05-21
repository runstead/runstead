import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { generateOpsDiagnosticsBundle } from "./ops-diagnostics.js";

describe("generateOpsDiagnosticsBundle", () => {
  it("writes diagnostics markdown, json, and a state backup", async () => {
    const workspace = join(tmpdir(), `runstead-ops-diagnostics-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({ cwd: workspace });
      await mkdir(join(initialized.root, "daemon"), { recursive: true });
      await writeFile(
        join(initialized.root, "daemon", "status.json"),
        `${JSON.stringify(
          {
            cwd: workspace,
            pid: process.pid,
            tick: 3,
            intervalMs: 30000,
            updatedAt: "2026-05-14T09:00:00.000Z",
            scheduledTasks: 1,
            skippedTasks: 0,
            ranTask: false,
            reason: "idle"
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await generateOpsDiagnosticsBundle({
        cwd: workspace,
        retentionDays: 14,
        now: new Date("2026-05-14T09:01:00.000Z")
      });
      const markdown = await readFile(result.markdownPath, "utf8");
      const json = await readFile(result.jsonPath, "utf8");

      expect(result.summary.doctorOk).toBe(true);
      expect(result.summary.daemon).toMatchObject({ tick: 3, stale: false });
      expect(result.summary.managerLock.status).toBe("missing");
      expect(result.summary.stateTables.goals).toBeGreaterThanOrEqual(0);
      expect(result.summary.artifacts.evidence?.path).toContain(".runstead/evidence");
      expect(result.summary.retention.retentionDays).toBe(14);
      expect(result.stateBackupPath).toContain("state-2026-05-14T09-01-00-000Z.db");
      await expect(access(result.stateBackupPath ?? "")).resolves.toBeUndefined();
      expect(markdown).toContain("Runstead Ops Diagnostics");
      expect(markdown).toContain("Timeout And Retry Profiles");
      expect(json).toContain('"doctorOk": true');
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
