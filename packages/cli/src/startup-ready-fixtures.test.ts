import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { stringify as stringifyYaml } from "yaml";

import { buildDashboard } from "./dashboard.js";
import { initRunstead } from "./init.js";
import { resumeInterruptedTasks } from "./resume.js";
import {
  inferStartupReadyUiSmokeFlowActions,
  runStartupReady
} from "./startup-ready.js";
import { recordStartupSourceEvidence } from "./startup-source-connectors.js";
import type { StartupUiFlowAction } from "./startup-ui-validation-types.js";
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

  it("dogfoods empty static todo through repair, verifiers, and UI smoke", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ready-static-todo-"));
    const port = await availablePort();
    let attempts = 0;

    try {
      await writeStaticTodoScaffoldProfile(workspace);
      const fullFlow = await inferStartupReadyUiSmokeFlowActions(workspace);

      await writeUiSmokeConfig(
        workspace,
        port,
        ["Todo MVP", "Add todo", "Search todos"],
        fullFlow
      );

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        appTemplate: "static-todo",
        appType: "local-first-web",
        maxAttempts: 2,
        workerRunner: async (_command, _args, options) => {
          attempts += 1;
          await writeStaticTodoApp(options.cwd, port, {
            verifierPasses: attempts > 1
          });

          return {
            stdout: JSON.stringify({
              summary:
                attempts === 1
                  ? "created static todo with failing verifier"
                  : "repaired static todo verifier",
              files_changed: [
                "package.json",
                "index.html",
                "styles.css",
                "app.js",
                "server.js",
                "scripts/test.js"
              ],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          };
        },
        now: new Date("2026-05-23T00:13:00.000Z")
      });
      const build = result.run.phases.find((phase) => phase.id === "build_mvp");
      const verifiers = result.run.phases.find((phase) => phase.id === "verifiers");
      const uiSmoke = result.run.phases.find((phase) => phase.id === "ui_smoke");

      expect(attempts).toBe(2);
      expect(build?.status).toBe("passed");
      expect(verifiers?.status).toBe("passed");
      expect(uiSmoke?.status).toBe("passed");
      expect(result.run.status).toBe("completed");
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.scaffoldProfile).toMatchObject({
        id: "static-todo",
        appOwnedPaths: [
          "index.html",
          "styles.css",
          "app.js",
          "server.js",
          "scripts/*.js"
        ]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 90_000);

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
      const persistedRun = JSON.parse(await readFile(result.path, "utf8")) as {
        guidedFlow: { id: string; status: string }[];
        operatorCommands: { kind: string; command: string }[];
      };
      const sourceEvidence = await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "github_actions",
        uri: "https://github.com/acme/tiny-todo/actions/runs/1",
        summary: "Tiny todo local launch CI passed",
        status: "passed",
        trustLevel: "authoritative",
        payload: JSON.stringify({
          workflow: "ci",
          conclusion: "success",
          headSha: "abc123"
        }),
        now: new Date("2026-05-23T00:16:00.000Z")
      });
      const dashboard = await buildDashboard({
        cwd: workspace,
        now: new Date("2026-05-23T00:17:00.000Z")
      });
      const dashboardHtml = await readFile(dashboard.htmlPath, "utf8");

      expect(verifiers?.status).toBe("passed");
      expect(uiSmoke?.status).toBe("passed");
      expect(complete).toBeDefined();
      expect(persistedRun.guidedFlow[0]).toMatchObject({
        id: "next_target",
        status: "next"
      });
      expect(persistedRun.operatorCommands.map((command) => command.kind)).toEqual([
        "resume",
        "rerun",
        "dashboard",
        "complete_check"
      ]);
      expect(sourceEvidence).toMatchObject({
        connector: "github_actions",
        qualityTier: "external_observed",
        payloadWarnings: []
      });
      expect(dashboard.snapshot.startup.latestRun).toMatchObject({
        id: result.run.id,
        verdict: "local_launch_ready"
      });
      expect(
        dashboard.snapshot.startup.latestRun?.operatorCommands.some(
          (command) => command.kind === "dashboard"
        )
      ).toBe(true);
      expect(dashboardHtml).toContain("Operator command");
      expect(dashboardHtml).toContain("runstead dashboard build --cwd");
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

  it("runs the codex_direct one-command golden path without prior init", async () => {
    await withFixture("tiny-todo", async (workspace) => {
      const port = await availablePort();
      await writeUiSmokeConfig(workspace, port, ["Todo MVP", "Add task"]);

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_direct",
        maxAttempts: 1,
        now: new Date("2026-05-23T00:16:30.000Z")
      });
      const build = result.run.phases.find((phase) => phase.id === "build_mvp");
      const verifiers = result.run.phases.find((phase) => phase.id === "verifiers");
      const uiSmoke = result.run.phases.find((phase) => phase.id === "ui_smoke");
      const launchReport = result.run.phases.find(
        (phase) => phase.id === "launch_report"
      );
      const complete = result.run.phases.find((phase) => phase.id === "complete_check");

      expect(result.plan.runsteadInitialized).toBe(false);
      await expect(access(join(workspace, ".runstead", "config.yaml"))).resolves.toBe(
        undefined
      );
      await expect(access(join(workspace, ".runstead", "state.db"))).resolves.toBe(
        undefined
      );
      await expect(readFile(join(workspace, "AGENTS.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(workspace, "CODEX.json"), "utf8")).rejects.toThrow();
      expect(result.run.worker).toBe("codex_direct");
      expect(build).toMatchObject({
        status: "passed",
        nextAction: "existing MVP verified; skipped worker build"
      });
      expect(verifiers?.status).toBe("passed");
      expect(uiSmoke?.status).toBe("passed");
      expect(launchReport?.status).toBe("passed");
      expect(complete?.status).toBe("passed");
      expect(result.run.status).toBe("completed");
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.reportPaths).toEqual(
        expect.arrayContaining([
          join(
            workspace,
            ".runstead",
            "reports",
            `startup-readiness-run-${result.run.id}.md`
          ),
          join(
            workspace,
            ".runstead",
            "reports",
            "launch-readiness-ai-native-startup.md"
          ),
          join(workspace, ".runstead", "reports", "startup-complete-product-check.md")
        ])
      );
      expect(
        result.run.operatorCommands.find((command) => command.kind === "rerun")?.command
      ).toContain("--worker codex_direct");
    });
  }, 90_000);

  it("skips the worker on a completed repo rerun", async () => {
    await withFixture("tiny-todo", async (workspace) => {
      const port = await availablePort();

      await writeUiSmokeConfig(workspace, port, ["Todo MVP", "Add task"]);

      const first = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:17:30.000Z")
      });
      let workerCalls = 0;
      const rerun = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: () => {
          workerCalls += 1;
          throw new Error("completed repo rerun should not call the MVP worker");
        },
        now: new Date("2026-05-23T00:18:00.000Z")
      });
      const build = rerun.run.phases.find((phase) => phase.id === "build_mvp");

      expect(first.run.verdict).toBe("local_launch_ready");
      expect(workerCalls).toBe(0);
      expect(build?.status).toBe("passed");
      expect(build?.nextAction).toBe("existing MVP verified; skipped worker build");
      expect(rerun.run.verdict).toBe("local_launch_ready");
    });
  }, 90_000);

  it("recovers stale and interrupted fixture tasks without overwriting the completed verdict", async () => {
    await withFixture("tiny-todo", async (workspace) => {
      const port = await availablePort();

      await writeUiSmokeConfig(workspace, port, ["Todo MVP", "Add task"]);

      const first = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:18:30.000Z")
      });

      seedInterruptedFixtureTask(workspace, {
        id: "task_fixture_interrupted_model_timeout",
        status: "interrupted",
        attempt: 1,
        maxAttempts: 1,
        output: {
          summary:
            "Codex Direct model request timed out after 20ms; runstead marked the task interrupted:model_timeout.",
          interruption: {
            reason: "model_timeout"
          }
        },
        createdAt: "2026-05-23T00:18:40.000Z"
      });

      const resumed = await resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-23T00:18:45.000Z")
      });

      seedInterruptedFixtureTask(workspace, {
        id: "task_fixture_stale_running",
        status: "running",
        attempt: 0,
        maxAttempts: 1,
        output: {
          summary: "stale running fixture task"
        },
        createdAt: "2026-05-23T00:18:50.000Z",
        leaseExpiresAt: "2026-05-23T00:18:55.000Z"
      });

      const rerun = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: successfulWorker,
        now: new Date("2026-05-23T00:19:30.000Z")
      });
      const tasks = listTasks({ cwd: workspace }).tasks;
      const stale = tasks.find((task) => task.id === "task_fixture_stale_running");
      const interrupted = tasks.find(
        (task) => task.id === "task_fixture_interrupted_model_timeout"
      );

      expect(first.run.verdict).toBe("local_launch_ready");
      expect(resumed.requeuedTasks.map((item) => item.task.id)).toContain(
        "task_fixture_interrupted_model_timeout"
      );
      expect(interrupted?.status).toBe("queued");
      expect(stale?.status).toBe("queued");
      expect(rerun.run.status).toBe("completed");
      expect(rerun.run.verdict).toBe("local_launch_ready");
      expect(rerun.run.verdictBlockers).toEqual([]);
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
      const firstStepSelectors = firstStep.selectors ?? [];

      expect(firstStepSelectors).toEqual(
        expect.arrayContaining([
          "[data-testid='new-todo-input']",
          "[data-testid='todo-input']",
          "#todo-input"
        ])
      );
      expect(firstStepSelectors).not.toContain("input[placeholder*='todo' i]");
      expect(firstStepSelectors.indexOf("#todo-input")).toBeLessThan(
        firstStepSelectors.indexOf(
          "input[type='text']:not([aria-label*='search' i]):not([placeholder*='search' i])"
        )
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
  expectText: string[],
  steps: StartupUiFlowAction[] = []
): Promise<void> {
  await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
  const url = `http://127.0.0.1:${port}`;
  const checks = [
    {
      name: steps.length === 0 ? "home" : "home-desktop-product-flow",
      url,
      viewport: "desktop",
      expectText,
      flow:
        steps.length === 0
          ? "load todo app"
          : "todo workflow: add, edit, complete, search/filter, delete, clear completed, reload persistence",
      ...(steps.length === 0 ? {} : { steps })
    },
    ...(steps.length === 0
      ? []
      : [
          {
            name: "home-mobile-product-layout",
            url,
            viewport: "mobile",
            expectText,
            flow: "mobile layout: no overlapping todo controls",
            steps: [
              {
                type: "expectNoOverlap" as const,
                selectors: [
                  "[data-testid='new-todo-input']",
                  "[data-testid='add-todo']",
                  "[data-testid='todo-search']",
                  "[data-testid='filter-active']",
                  "[data-testid='filter-completed']",
                  "[data-testid='filter-all']",
                  "[data-testid='clear-completed']"
                ]
              }
            ]
          }
        ])
  ];

  await writeFile(
    join(workspace, ".runstead", "startup", "ui-smoke.yaml"),
    stringifyYaml(
      {
        schemaVersion: 1,
        server: {
          command: "npm run dev",
          port,
          url,
          timeoutMs: 5000
        },
        checks
      },
      { lineWidth: 0 }
    ),
    "utf8"
  );
}

async function writeStaticTodoScaffoldProfile(workspace: string): Promise<void> {
  await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
  await writeFile(
    join(workspace, ".runstead", "startup", "scaffold-profile.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        profile: {
          id: "static-todo",
          template: "static-todo"
        }
      },
      null,
      2
    )}\n`,
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

async function writeStaticTodoApp(
  workspace: string,
  port: number,
  options: { verifierPasses: boolean }
): Promise<void> {
  await mkdir(join(workspace, "scripts"), { recursive: true });
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify(
      {
        name: "runstead-static-todo-fixture",
        private: true,
        scripts: {
          test: "node scripts/test.js",
          lint: "node scripts/lint.js",
          typecheck: "node scripts/typecheck.js",
          build: "node scripts/build.js",
          dev: "node server.js"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(workspace, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head>",
      '  <meta charset="utf-8">',
      "  <title>Todo MVP</title>",
      '  <link rel="stylesheet" href="/styles.css">',
      "</head>",
      "<body>",
      "  <main>",
      "    <h1>Todo MVP</h1>",
      '    <form data-testid="todo-form">',
      '      <label for="todo-input">Add todo</label>',
      '      <input id="todo-input" data-testid="new-todo-input" type="text">',
      '      <button data-testid="add-todo" type="submit">Add todo</button>',
      "    </form>",
      '    <section class="toolbar" aria-label="Todo filters">',
      '      <label for="todo-search">Search todos</label>',
      '      <input id="todo-search" data-testid="todo-search" type="search">',
      '      <button data-testid="filter-all" type="button">All</button>',
      '      <button data-testid="filter-active" type="button">Active</button>',
      '      <button data-testid="filter-completed" type="button">Completed</button>',
      '      <button data-testid="clear-completed" type="button">Clear completed</button>',
      "    </section>",
      '    <p data-testid="todo-count">0 active</p>',
      '    <ul data-testid="todo-list"></ul>',
      "  </main>",
      '  <script src="/app.js"></script>',
      "</body>",
      "</html>",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, "styles.css"),
    [
      "body { font-family: system-ui, sans-serif; margin: 0; color: #172026; background: #f7f7f4; }",
      "main { width: min(760px, calc(100% - 32px)); margin: 32px auto; }",
      "form, .toolbar, li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }",
      "input { min-height: 36px; padding: 0 10px; border: 1px solid #9aa3a6; border-radius: 6px; }",
      "button { min-height: 36px; padding: 0 12px; border: 1px solid #48645f; border-radius: 6px; background: #ffffff; color: #172026; }",
      "ul { list-style: none; padding: 0; display: grid; gap: 10px; }",
      "li { justify-content: space-between; padding: 10px; border: 1px solid #d5d8d4; background: #ffffff; border-radius: 8px; }",
      ".todo-title { flex: 1 1 180px; }",
      ".completed .todo-title { text-decoration: line-through; color: #6b7270; }",
      "@media (max-width: 520px) { main { margin: 20px auto; } form > *, .toolbar > * { flex: 1 1 100%; } li { align-items: flex-start; } }",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, "app.js"),
    [
      "const storageKey = 'runstead.static.todo.fixture';",
      "const form = document.querySelector('[data-testid=\"todo-form\"]');",
      "const input = document.querySelector('[data-testid=\"new-todo-input\"]');",
      "const search = document.querySelector('[data-testid=\"todo-search\"]');",
      "const list = document.querySelector('[data-testid=\"todo-list\"]');",
      "const count = document.querySelector('[data-testid=\"todo-count\"]');",
      "let filter = 'all';",
      "let editingId = null;",
      "let todos = [];",
      "try {",
      "  todos = JSON.parse(localStorage.getItem(storageKey) || '[]');",
      "} catch {",
      "  todos = [];",
      "}",
      "function save() {",
      "  localStorage.setItem(storageKey, JSON.stringify(todos));",
      "}",
      "function visibleTodos() {",
      "  const query = (search.value || '').toLowerCase();",
      "  return todos.filter((todo) => {",
      "    const matchesSearch = todo.title.toLowerCase().includes(query);",
      "    const matchesFilter = filter === 'all' || (filter === 'active' ? !todo.completed : todo.completed);",
      "    return matchesSearch && matchesFilter;",
      "  });",
      "}",
      "function render() {",
      "  list.innerHTML = '';",
      "  const activeCount = todos.filter((todo) => !todo.completed).length;",
      "  count.textContent = `${activeCount} active`;",
      "  for (const todo of visibleTodos()) {",
      "    const item = document.createElement('li');",
      "    item.dataset.testid = 'todo-item';",
      "    item.className = todo.completed ? 'completed' : '';",
      "    const toggle = document.createElement('input');",
      "    toggle.type = 'checkbox';",
      "    toggle.checked = todo.completed;",
      "    toggle.dataset.testid = 'todo-toggle';",
      "    toggle.setAttribute('aria-label', `Complete ${todo.title}`);",
      "    toggle.addEventListener('change', () => {",
      "      todo.completed = toggle.checked;",
      "      save();",
      "      render();",
      "    });",
      "    item.append(toggle);",
      "    if (editingId === todo.id) {",
      "      const editInput = document.createElement('input');",
      "      editInput.value = todo.title;",
      "      editInput.dataset.testid = 'todo-edit-input';",
      "      editInput.setAttribute('aria-label', 'Edit todo');",
      "      const saveButton = document.createElement('button');",
      "      saveButton.type = 'button';",
      "      saveButton.dataset.testid = 'save-todo';",
      "      saveButton.textContent = 'Save';",
      "      saveButton.addEventListener('click', () => {",
      "        todo.title = editInput.value.trim() || todo.title;",
      "        editingId = null;",
      "        save();",
      "        render();",
      "      });",
      "      item.append(editInput, saveButton);",
      "    } else {",
      "      const title = document.createElement('span');",
      "      title.className = 'todo-title';",
      "      title.textContent = todo.title;",
      "      const edit = document.createElement('button');",
      "      edit.type = 'button';",
      "      edit.dataset.testid = 'edit-todo';",
      "      edit.textContent = 'Edit';",
      "      edit.addEventListener('click', () => {",
      "        editingId = todo.id;",
      "        render();",
      "      });",
      "      const remove = document.createElement('button');",
      "      remove.type = 'button';",
      "      remove.dataset.testid = 'delete-todo';",
      "      remove.textContent = 'Delete';",
      "      remove.addEventListener('click', () => {",
      "        todos = todos.filter((itemTodo) => itemTodo.id !== todo.id);",
      "        save();",
      "        render();",
      "      });",
      "      item.append(title, edit, remove);",
      "    }",
      "    list.append(item);",
      "  }",
      "}",
      "form.addEventListener('submit', (event) => {",
      "  event.preventDefault();",
      "  const title = input.value.trim();",
      "  if (title.length === 0) return;",
      "  todos = [...todos, { id: `${Date.now()}-${Math.random()}`, title, completed: false }];",
      "  input.value = '';",
      "  save();",
      "  render();",
      "});",
      "search.addEventListener('input', render);",
      "document.querySelector('[data-testid=\"filter-all\"]').addEventListener('click', () => { filter = 'all'; render(); });",
      "document.querySelector('[data-testid=\"filter-active\"]').addEventListener('click', () => { filter = 'active'; render(); });",
      "document.querySelector('[data-testid=\"filter-completed\"]').addEventListener('click', () => { filter = 'completed'; render(); });",
      "document.querySelector('[data-testid=\"clear-completed\"]').addEventListener('click', () => {",
      "  todos = todos.filter((todo) => !todo.completed);",
      "  save();",
      "  render();",
      "});",
      "render();",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(workspace, "server.js"),
    [
      "const { createServer } = require('node:http');",
      "const { readFile } = require('node:fs/promises');",
      "const { extname, join } = require('node:path');",
      `const port = Number(process.env.PORT || ${port});`,
      "const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };",
      "createServer(async (req, res) => {",
      "  const url = req.url === '/' ? '/index.html' : req.url || '/index.html';",
      "  const path = join(__dirname, url.replace(/^\\/+/, ''));",
      "  try {",
      "    res.setHeader('content-type', types[extname(path)] || 'text/plain');",
      "    res.end(await readFile(path));",
      "  } catch {",
      "    res.statusCode = 404;",
      "    res.end('not found');",
      "  }",
      "}).listen(port, '127.0.0.1');",
      ""
    ].join("\n"),
    "utf8"
  );

  for (const script of ["lint", "typecheck", "build"]) {
    await writeFile(join(workspace, "scripts", `${script}.js`), "process.exit(0);\n");
  }

  await writeFile(
    join(workspace, "scripts", "test.js"),
    options.verifierPasses
      ? "process.exit(0);\n"
      : "console.error('intentional first-attempt verifier failure'); process.exit(1);\n",
    "utf8"
  );
}

function seedInterruptedFixtureTask(
  workspace: string,
  input: {
    id: string;
    status: Task["status"];
    attempt: number;
    maxAttempts: number;
    output: Task["output"];
    createdAt: string;
    leaseExpiresAt?: string;
  }
): void {
  const goal: Goal = {
    id: `goal_${input.id}`,
    domain: "repo-maintenance",
    title: `Fixture ${input.id}`,
    status: "active",
    priority: "medium",
    scope: {
      repositoryPath: workspace
    },
    policyRef: "policy_repo_maintenance_v1",
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
  const task: Task = {
    id: input.id,
    goalId: goal.id,
    domain: "repo-maintenance",
    type: "local_agent_task",
    status: input.status,
    priority: "medium",
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    input: {
      repositoryPath: workspace,
      prompt: "fixture interrupted task",
      worker: "codex_direct",
      mode: "repair"
    },
    ...(input.output === undefined ? {} : { output: input.output }),
    verifiers: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt
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
        createdAt: input.createdAt
      },
      projection: {
        type: "goal",
        value: goal
      }
    });
    appendEventAndProject(database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: input.status === "interrupted" ? "task.interrupted" : "task.started",
        aggregateType: "task",
        aggregateId: task.id,
        payload: task,
        createdAt: input.createdAt
      },
      projection: {
        type: "task",
        value: task
      }
    });

    if (input.leaseExpiresAt !== undefined) {
      database
        .prepare(
          "UPDATE tasks SET owner_id = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?"
        )
        .run("pid:999999999", input.leaseExpiresAt, input.createdAt, input.id);
    }
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
