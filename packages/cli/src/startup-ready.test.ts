import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createStartupReadinessRun,
  evaluateStartupReadinessVerdict,
  formatStartupReadinessRun,
  formatStartupReadyPlan,
  planStartupReady,
  readStartupReadinessRun,
  runStartupReady,
  type StartupReadinessRunPhase
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
        "launch_report",
        "complete_check"
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
        ci: true,
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
      const decisionReport = result.run.reportPaths.find((path) =>
        path.endsWith(`startup-readiness-run-${result.run.id}.md`)
      );

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
      expect(result.run.evidenceTiers).toContain("local_command");
      expect(result.run.evidenceTiers).toContain("ci_verified");
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.verdictBlockers).toEqual([]);
      expect(result.run.reportPaths).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "reports", "runstead-startup-ci-summary.md"),
          join(workspace, ".runstead", "reports", "runstead-startup-ci-summary.json")
        ])
      );
      expect(decisionReport).toBeDefined();
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        "## Can this launch?"
      );
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        "| Local demo | yes | local_launch_ready |"
      );
      expect(persisted).toEqual(result.run);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("plans missing launch evidence before execution", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-plan-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const plan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "production",
        now: new Date("2026-05-22T01:20:00.000Z")
      });
      const verifiers = plan.phases.find((phase) => phase.id === "verifiers");
      const uiSmoke = plan.phases.find((phase) => phase.id === "ui_smoke");
      const launchAudit = plan.phases.find((phase) => phase.id === "launch_audit");
      const launchReport = plan.phases.find((phase) => phase.id === "launch_report");
      const formatted = formatStartupReadyPlan(plan);

      expect(verifiers?.blockers).toEqual(
        expect.arrayContaining([
          "package manager is missing",
          "test command is missing",
          "build command is missing"
        ])
      );
      expect(uiSmoke?.blockers).toEqual(
        expect.arrayContaining(["UI validation evidence is missing"])
      );
      expect(launchAudit?.blockers).toEqual(
        expect.arrayContaining([
          "CI provider is missing for staging or production target",
          "release-plan evidence is missing",
          "rollback-plan evidence is missing",
          "observability evidence is missing"
        ])
      );
      expect(launchReport?.blockers).toEqual(
        expect.arrayContaining([
          "production deployment evidence is missing",
          "real-user analytics evidence is missing",
          "support or feedback triage evidence is missing"
        ])
      );
      expect(formatted).toContain("Worker: codex_cli");
      expect(formatted).toContain("Level 1 process wrapper path");
      expect(formatted).toContain("worker-internal tool calls are not hard-proxied");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("surfaces strict native proxy governance for codex_direct", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-governance-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const { run } = await createStartupReadinessRun({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_direct",
        now: new Date("2026-05-22T01:25:00.000Z")
      });
      const formatted = formatStartupReadinessRun(run);

      expect(formatted).toContain("Worker: codex_direct");
      expect(formatted).toContain("Level 2 native tool proxy path");
      expect(formatted).toContain("model tool calls are governed inside Runstead");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("resumes an existing readiness run id", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-resume-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-resume-fixture",
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
      const created = await createStartupReadinessRun({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        now: new Date("2026-05-22T01:25:00.000Z")
      });

      const result = await runStartupReady({
        cwd: workspace,
        resumeRunId: created.run.id,
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "resumed MVP fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:26:00.000Z")
      });

      expect(result.run.id).toBe(created.run.id);
      expect(result.run.status).toBe("completed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("keeps higher launch targets blocked until stronger evidence tiers exist", () => {
    const phases: StartupReadinessRunPhase[] = [
      {
        id: "verifiers",
        title: "Run verifiers",
        status: "passed",
        evidenceIds: ["ev_command"],
        artifacts: [],
        blockers: []
      },
      {
        id: "ui_smoke",
        title: "UI smoke",
        status: "passed",
        evidenceIds: ["ev_smoke"],
        artifacts: [],
        blockers: []
      }
    ];

    expect(
      evaluateStartupReadinessVerdict({
        run: {
          target: "local",
          phases
        },
        evidenceTiers: ["local_command", "synthetic_smoke"]
      }).verdict
    ).toBe("local_launch_ready");
    const production = evaluateStartupReadinessVerdict({
      run: {
        target: "production",
        phases
      },
      evidenceTiers: ["local_command", "synthetic_smoke", "security_scan"],
      evidenceTypes: ["startup_security_baseline"]
    });

    expect(production.verdict).toBe("public_launch_blocked");
    expect(production.blockers).toEqual(
      expect.arrayContaining([
        "CI-verified evidence is required for staging or production",
        "production deployment evidence is required",
        "real-user analytics evidence is required",
        "support or feedback triage evidence is required",
        "rollback-plan evidence is required",
        "observability evidence is required"
      ])
    );
  });

  it("loads UI smoke config and executes the launch UI phase", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-ui-${process.pid}`);
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-ui-fixture",
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
      await writeFile(
        join(workspace, "server.mjs"),
        [
          "import http from 'node:http';",
          "const html = '<!doctype html><html><body><main><h1>Todo MVP</h1><button>Add todo</button></main></body></html>';",
          "const server = http.createServer((_request, response) => {",
          "  response.writeHead(200, { 'content-type': 'text/html' });",
          "  response.end(html);",
          "});",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, ".runstead", "startup", "ui-smoke.yaml"),
        [
          "schemaVersion: 1",
          "server:",
          "  command: node server.mjs",
          `  port: ${port}`,
          `  url: http://127.0.0.1:${port}`,
          "  timeoutMs: 5000",
          "checks:",
          "  - name: home",
          `    url: http://127.0.0.1:${port}`,
          "    viewport: desktop",
          "    expectText:",
          "      - Todo MVP",
          "      - Add todo",
          "    flow: load todo app",
          ""
        ].join("\n"),
        "utf8"
      );

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "built launch fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:30:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");
      const completePhase = result.run.phases.find(
        (phase) => phase.id === "complete_check"
      );

      expect(uiPhase).toMatchObject({
        status: "passed",
        blockers: []
      });
      expect(uiPhase?.evidenceIds).toHaveLength(1);
      expect(uiPhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "startup", "ui-smoke.yaml")
        ])
      );
      expect(completePhase).toBeDefined();
      expect(completePhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "reports", "startup-complete-product-check.md"),
          join(workspace, ".runstead", "reports", "startup-complete-product-check.json")
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("accepts legacy agent-generated UI smoke config shape", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-legacy-ui-${process.pid}`);
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-legacy-ui-fixture",
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
      await writeFile(
        join(workspace, "server.mjs"),
        [
          "import http from 'node:http';",
          "const html = '<!doctype html><html><body><main><h1>Todo app</h1><button>Clear completed</button></main></body></html>';",
          "const server = http.createServer((_request, response) => {",
          "  response.writeHead(200, { 'content-type': 'text/html' });",
          "  response.end(html);",
          "});",
          "server.listen(Number(process.env.PORT), '127.0.0.1');",
          "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, ".runstead", "startup", "ui-smoke.yaml"),
        [
          "version: 1",
          "name: todo-ui-smoke",
          "startup:",
          "  run: node server.mjs",
          "  readyWhen:",
          `    url: http://127.0.0.1:${port}`,
          "    status: 200",
          "checks:",
          "  - name: todo-text-visible",
          "    request:",
          `      url: http://127.0.0.1:${port}`,
          "      method: GET",
          "    expect:",
          "      status: 200",
          "      bodyContains:",
          "        - Todo app",
          "        - Clear completed",
          ""
        ].join("\n"),
        "utf8"
      );

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "built launch fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:35:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");

      expect(uiPhase).toMatchObject({
        status: "passed",
        blockers: []
      });
      expect(uiPhase?.evidenceIds).toHaveLength(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);
});

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
