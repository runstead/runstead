import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRunsteadId,
  type Evidence,
  type Goal,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  inferStartupReadyUiSmokeFlowActions,
  runStartupReady
} from "./startup-ready.js";
import { listTasks } from "./tasks.js";
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

  it("runs the todo dogfood regression fixture with legacy evidence repair", async () => {
    await withFixture("todo-dogfood-regression", async (workspace) => {
      const port = await availablePort();

      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await seedLegacyStartupMetricSnapshot(workspace);
      seedStaleStartupRemediationTask(workspace);
      await writeUiSmokeConfig(workspace, port, [
        "Todo MVP",
        "Add todo",
        "Search todos"
      ]);

      const inferredSteps = await inferStartupReadyUiSmokeFlowActions(workspace);

      const firstStep = inferredSteps[0];
      expect(firstStep?.type).toBe("fill");
      if (firstStep?.type !== "fill") {
        throw new Error("Expected first inferred UI smoke step to fill todo input");
      }
      expect(firstStep.selectors).toEqual(
        expect.arrayContaining([
          "[data-testid='todo-input']",
          "#todo-input",
          "input[placeholder*='todo' i]"
        ])
      );
      expect(
        inferredSteps[0]?.type === "fill"
          ? inferredSteps[0].selectors?.indexOf("#todo-input")
          : -1
      ).toBeLessThan(
        inferredSteps[0]?.type === "fill"
          ? (inferredSteps[0].selectors?.indexOf("input[placeholder*='todo' i]") ?? -1)
          : -1
      );

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:18:00.000Z")
      });
      const remediationTask = listTasks({ cwd: workspace }).tasks.find(
        (task) => task.id === "task_todo_dogfood_stale_remediation"
      );

      expect(result.run.status).toBe("completed");
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.phases.find((phase) => phase.id === "ui_smoke")?.status).toBe(
        "passed"
      );
      expect(evidenceCount(workspace, "startup_metric_snapshot")).toBeGreaterThan(1);
      expect(remediationTask).toMatchObject({
        status: "cancelled",
        output: {
          superseded: {
            byRunId: result.run.id
          }
        }
      });
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

async function seedLegacyStartupMetricSnapshot(workspace: string): Promise<void> {
  const evidenceId = createRunsteadId("ev");
  const eventId = createRunsteadId("evt");
  const createdAt = "2026-05-23T00:11:00.000Z";
  const artifactPath = join(
    workspace,
    ".runstead",
    "evidence",
    `startup-metric_snapshot-${evidenceId}.json`
  );
  const artifact = {
    schemaVersion: 1,
    createdAt,
    evidenceType: "metric_snapshot",
    summary: "Legacy malformed metric snapshot from todo dogfood",
    sourceRefs: [],
    sources: [],
    provenance: {
      recordedBy: "todo-dogfood-regression",
      recordedAt: createdAt,
      sourceCount: 0,
      sourceKinds: [],
      captureMode: "manual_seed"
    },
    associations: {
      gate: "launch"
    },
    content: JSON.stringify(
      {
        metric: "local_required_checks_passed",
        source: "manual",
        threshold: 1,
        currentValue: 1
      },
      null,
      2
    )
  };
  const evidence: Evidence = {
    id: evidenceId,
    type: "startup_metric_snapshot",
    subjectType: "startup",
    subjectId: "ai-native-startup",
    uri: pathToFileURL(artifactPath).href,
    summary: "Legacy malformed metric snapshot from todo dogfood",
    createdAt
  };
  const event: RunsteadEvent = {
    eventId,
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: evidence,
    createdAt
  };
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    await mkdir(join(workspace, ".runstead", "evidence"), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    appendEventAndProject(database, {
      event,
      projection: {
        type: "evidence",
        value: evidence
      }
    });
  } finally {
    database.close();
  }
}

function seedStaleStartupRemediationTask(workspace: string): void {
  const createdAt = "2026-05-23T00:12:00.000Z";
  const goal: Goal = {
    id: "goal_todo_dogfood_regression",
    domain: "ai-native-startup",
    title: "Todo dogfood regression",
    status: "active",
    priority: "medium",
    scope: {
      repositoryPath: workspace
    },
    policyRef: "policy_startup_mvp_v1",
    createdAt,
    updatedAt: createdAt
  };
  const task: Task = {
    id: "task_todo_dogfood_stale_remediation",
    goalId: goal.id,
    domain: "ai-native-startup",
    type: "startup_remediation",
    status: "blocked",
    priority: "medium",
    attempt: 1,
    maxAttempts: 1,
    input: {
      stage: "launch",
      blocker: "old UI smoke blocker"
    },
    output: {
      summary: "Stale remediation from earlier dogfood run"
    },
    verifiers: [],
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: task,
    createdAt
  };
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    appendEventAndProject(database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: "goal.created",
        aggregateType: "goal",
        aggregateId: goal.id,
        payload: goal,
        createdAt
      },
      projection: {
        type: "goal",
        value: goal
      }
    });
    appendEventAndProject(database, {
      event,
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

function evidenceCount(workspace: string, type: string): number {
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM evidence WHERE type = ?")
      .get(type) as { count: number };

    return row.count;
  } finally {
    database.close();
  }
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
