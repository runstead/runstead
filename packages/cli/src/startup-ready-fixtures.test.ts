import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runStartupReady } from "./startup-ready.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

const fixturesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../domain-packs/packs/ai-native-startup/fixtures"
);

describe("startup ready fixture matrix", () => {
  it("returns explicit blockers for an empty repo", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ready-empty-"));

    try {
      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:10:00.000Z")
      });
      const build = result.run.phases.find((phase) => phase.id === "build_mvp");
      const verifiers = result.run.phases.find((phase) => phase.id === "verifiers");

      expect(result.run.status).toBe("failed");
      expect(result.run.verdict).toBe("local_launch_blocked");
      expect(build?.status).toBe("failed");
      expect(verifiers?.status).toBe("blocked");
      expect(verifiers?.blockers).toContain("test verifier failed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("runs the tiny todo golden path through launch readiness", async () => {
    await withFixture("tiny-todo", async (workspace) => {
      const port = await availablePort();
      await writeUiSmokeConfig(workspace, port, ["Todo MVP", "Add task"]);

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:15:00.000Z")
      });
      const verifiers = result.run.phases.find((phase) => phase.id === "verifiers");
      const uiSmoke = result.run.phases.find((phase) => phase.id === "ui_smoke");
      const complete = result.run.phases.find((phase) => phase.id === "complete_check");

      expect(verifiers?.status).toBe("passed");
      expect(uiSmoke?.status).toBe("passed");
      expect(complete).toBeDefined();
      expect(result.run.reportPaths).toEqual(
        expect.arrayContaining([
          join(
            workspace,
            ".runstead",
            "reports",
            `startup-readiness-run-${result.run.id}.md`
          ),
          join(workspace, ".runstead", "reports", "startup-complete-product-check.md")
        ])
      );
    });
  }, 90_000);

  it("keeps a broken launch repo blocked with verifier and UI blockers", async () => {
    await withFixture("broken-launch-repo", async (workspace) => {
      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:20:00.000Z")
      });
      const verifiers = result.run.phases.find((phase) => phase.id === "verifiers");
      const uiSmoke = result.run.phases.find((phase) => phase.id === "ui_smoke");

      expect(result.run.status).toBe("failed");
      expect(verifiers?.status).toBe("blocked");
      expect(uiSmoke?.status).toBe("blocked");
      expect(
        uiSmoke?.blockers.some((blocker) =>
          blocker.includes("No dev server command found")
        )
      ).toBe(true);
    });
  }, 90_000);

  it("runs an AI-coded MVP smoke fixture to local MVP readiness", async () => {
    await withFixture("ai-coded-mvp-smoke", async (workspace) => {
      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:25:00.000Z")
      });

      expect(result.run.status).toBe("completed");
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.phases.find((phase) => phase.id === "verifiers")?.status).toBe(
        "passed"
      );
    });
  }, 60_000);

  it("plans an existing mature repo with CI and launch evidence gaps separated", async () => {
    await withFixture("existing-mature-repo", async (workspace) => {
      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:30:00.000Z")
      });

      expect(result.run.status).toBe("completed");
      expect(result.run.phases.find((phase) => phase.id === "verifiers")?.status).toBe(
        "passed"
      );
      expect(result.run.evidenceTiers).toContain("local_command");
    });
  }, 60_000);
});

async function withFixture(
  fixtureName: string,
  callback: (workspace: string) => Promise<void>
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), `runstead-ready-${fixtureName}-`));

  try {
    await cp(join(fixturesRoot, fixtureName), workspace, { recursive: true });
    await callback(workspace);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function writeUiSmokeConfig(
  workspace: string,
  port: number,
  expectText: string[]
): Promise<void> {
  await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
  await writeFile(
    join(workspace, ".runstead", "startup", "ui-smoke.yaml"),
    [
      "schemaVersion: 1",
      "server:",
      "  command: npm run dev",
      `  port: ${port}`,
      `  url: http://127.0.0.1:${port}`,
      "  timeoutMs: 5000",
      "checks:",
      "  - name: home",
      `    url: http://127.0.0.1:${port}`,
      "    viewport: desktop",
      "    expectText:",
      ...expectText.map((text) => `      - ${text}`),
      "    flow: load todo app",
      ""
    ].join("\n"),
    "utf8"
  );
}

function successfulWorker(): ReturnType<WorkerProcessRunner> {
  return Promise.resolve({
    stdout: JSON.stringify({
      summary: "fixture worker completed",
      files_changed: [],
      commands_run: [],
      risks: [],
      needs_approval: false,
      approval_reason: null
    }),
    stderr: "",
    exitCode: 0
  });
}

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      server.close(() => {
        if (typeof address === "object" && address !== null) {
          resolvePort(address.port);
          return;
        }

        reject(new Error("Failed to allocate test port"));
      });
    });
  });
}
