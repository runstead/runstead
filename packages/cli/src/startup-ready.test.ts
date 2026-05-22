import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createStartupReadinessRun, readStartupReadinessRun } from "./startup-ready.js";

describe("startup readiness run model", () => {
  it("persists and reads a readiness run with phase state", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const { run, path } = await createStartupReadinessRun({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        now: new Date("2026-05-22T01:00:00.000Z")
      });
      const loaded = await readStartupReadinessRun({
        cwd: workspace,
        runId: run.id
      });

      expect(path).toContain(".runstead/startup/readiness-runs/");
      expect(run).toMatchObject({
        schemaVersion: 1,
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        status: "planned",
        startedAt: "2026-05-22T01:00:00.000Z"
      });
      expect(run.id).toMatch(/^run_[a-f0-9]{32}$/);
      expect(run.phases.map((phase) => phase.id)).toEqual([
        "onboard",
        "context",
        "measurement",
        "build_mvp",
        "verifiers",
        "ui_smoke",
        "launch_audit",
        "launch_report"
      ]);
      expect(loaded.run).toEqual(run);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
