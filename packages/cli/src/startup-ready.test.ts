import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createStartupReadinessRun,
  readStartupReadinessRun,
  runStartupReady
} from "./startup-ready.js";

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

  it("executes the MVP readiness phases and persists the final run", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-exec-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-exec-fixture",
            private: true,
            scripts: {
              test: 'node -e "process.exit(0)"',
              lint: 'node -e "process.exit(0)"',
              typecheck: 'node -e "process.exit(0)"',
              build: 'node -e "process.exit(0)"'
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "built MVP fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:15:00.000Z")
      });
      const persisted = JSON.parse(await readFile(result.path, "utf8")) as unknown;

      expect(result.run.status).toBe("completed");
      expect(result.run.phases.map((phase) => [phase.id, phase.status])).toEqual([
        ["onboard", "passed"],
        ["context", "passed"],
        ["measurement", "passed"],
        ["build_mvp", "passed"],
        ["verifiers", "passed"]
      ]);
      expect(
        result.run.phases.find((phase) => phase.id === "verifiers")?.evidenceIds
      ).toHaveLength(4);
      expect(result.run.evidenceIds.length).toBeGreaterThanOrEqual(6);
      expect(persisted).toEqual(result.run);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);
});
