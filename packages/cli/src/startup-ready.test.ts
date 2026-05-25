import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  createRunsteadId,
  type Evidence,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { describe, expect, it } from "vitest";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { buildDashboard } from "./dashboard.js";
import { initRunstead } from "./init.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { storeCommandVerifierEvidence } from "./verifier-evidence.js";
import {
  createStartupReadinessRun,
  evaluateStartupReadinessVerdict,
  formatStartupReadinessRun,
  formatStartupReadyPlan,
  inferStartupReadyUiSmokeExpectText,
  planStartupReady,
  readStartupReadinessRun,
  runStartupReady,
  startupBuildMvpPhaseExecutionStatus,
  type StartupReadyProgressEvent,
  type StartupReadinessRun,
  type StartupReadinessRunPhase
} from "./startup-ready.js";

const execFileAsync = promisify(execFile);

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
        governanceProfile: "readiness",
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
        "extensions",
        "launch_audit",
        "launch_report",
        "complete_check"
      ]);
      expect(run.guidedFlow.length).toBeGreaterThan(0);
      expect(run.operatorCommands.map((command) => command.kind)).toEqual([
        "resume",
        "rerun",
        "dashboard",
        "complete_check"
      ]);
      expect(run.operatorCommands[0]?.command).toContain(`--resume ${run.id}`);
      expect(formatStartupReadinessRun(run)).toContain("Operator commands:");
      expect(loaded.run).toEqual(run);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records unborn git state with a code fingerprint", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-unborn-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await git(workspace, "init");
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "startup-ready-unborn-fixture" }, null, 2)}\n`,
        "utf8"
      );

      const { run } = await createStartupReadinessRun({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        now: new Date("2026-05-22T01:05:00.000Z")
      });

      expect(run.gitHead).toBe("unborn");
      expect(run.dirtyState).toBe("dirty");
      expect(run.codeFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(formatStartupReadinessRun(run)).toContain("Git head: unborn");
      expect(formatStartupReadinessRun(run)).toContain("Code fingerprint:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("splits dirty state by product, generated context, and dependency source", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-dirty-breakdown-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, "src"), { recursive: true });
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "dirty-breakdown-fixture" }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(join(workspace, "src", "app.js"), "export const app = 1;\n");
      await git(workspace, "add", ".");
      await git(workspace, "commit", "-m", "initial app");
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          { name: "dirty-breakdown-fixture", scripts: { test: "node -v" } },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(join(workspace, "src", "app.js"), "export const app = 2;\n");
      await writeFile(join(workspace, "AGENTS.json"), '{"generated":true}\n');

      const { run } = await createStartupReadinessRun({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        now: new Date("2026-05-22T01:06:00.000Z")
      });
      const formatted = formatStartupReadinessRun(run);

      expect(run.dirtyState).toBe("dirty");
      expect(run.dirtyBreakdown).toMatchObject({
        productDirty: true,
        runsteadGeneratedDirty: true,
        dependencyDirty: true,
        ignoredRuntimeDirty: false,
        unknownDirty: false,
        productFiles: ["src/app.js"],
        runsteadGeneratedFiles: ["AGENTS.json"],
        dependencyFiles: ["package.json"]
      });
      expect(formatted).toContain("Dirty categories:");
      expect(formatted).toContain("product:1");
      expect(formatted).toContain("runstead_generated:1");
      expect(formatted).toContain("dependency:1");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("marks command evidence stale after the code fingerprint changes", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-stale-code-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-stale-code-fixture",
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
      await writeFile(join(workspace, "index.html"), "<h1>Todo MVP</h1>\n", "utf8");
      await git(workspace, "add", "package.json", "index.html");
      await git(workspace, "commit", "-m", "initial app");
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));
      let staleEvidenceId = "";

      try {
        const stored = await storeCommandVerifierEvidence({
          cwd: workspace,
          runsteadRoot: join(workspace, ".runstead"),
          database,
          task: startupReadyVerifierTask(),
          command: {
            name: "test",
            command: 'node -e "process.exit(0)"'
          },
          now: new Date("2026-05-22T01:08:00.000Z")
        });
        staleEvidenceId = stored.evidence.id;
      } finally {
        database.close();
      }

      await writeFile(
        join(workspace, "index.html"),
        "<h1>Todo MVP changed</h1>\n",
        "utf8"
      );
      await git(workspace, "add", "index.html");
      await git(workspace, "commit", "-m", "change app");

      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        workerRunner: () => {
          throw new Error("green-path verifier should avoid the worker");
        },
        now: new Date("2026-05-22T01:10:00.000Z")
      });

      expect(result.run.staleEvidenceRefs).toContain(staleEvidenceId);
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.gitHead).toMatch(/^[a-f0-9]{40}$/);
      expect(result.run.codeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

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
      const progress: StartupReadyProgressEvent[] = [];

      const result = await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        ci: true,
        onProgress: (event) => {
          progress.push(event);
        },
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
      const decisionJson = result.run.reportPaths.find((path) =>
        path.endsWith(`startup-readiness-run-${result.run.id}.json`)
      );

      expect(result.run.status).toBe("completed");
      expect(progress.map((event) => [event.phaseId ?? "run", event.status])).toEqual(
        expect.arrayContaining([
          ["run", "started"],
          ["onboard", "started"],
          ["onboard", "completed"],
          ["context", "completed"],
          ["measurement", "completed"],
          ["build_mvp", "started"],
          ["build_mvp", "completed"],
          ["verifiers", "completed"],
          ["run", "completed"]
        ])
      );
      expect(
        progress.find(
          (event) => event.phaseId === "verifiers" && event.status === "completed"
        )?.evidenceIds
      ).toHaveLength(4);
      expect(result.run.phases.map((phase) => [phase.id, phase.status])).toEqual([
        ["onboard", "passed"],
        ["context", "passed"],
        ["measurement", "passed"],
        ["build_mvp", "passed"],
        ["verifiers", "passed"]
      ]);
      expect(
        result.run.phases.find((phase) => phase.id === "context")?.artifacts
      ).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "startup", "current-agent-context.md"),
          join(workspace, ".runstead", "startup", "current-agent-context.json")
        ])
      );
      await expect(
        readFile(
          join(workspace, ".runstead", "startup", "current-agent-context.md"),
          "utf8"
        )
      ).resolves.toContain("Startup Agent Context");
      await expect(
        readFile(
          join(workspace, ".runstead", "startup", "current-agent-context.json"),
          "utf8"
        )
      ).resolves.toContain('"contextScope": "current"');
      expect(
        result.run.phases.find((phase) => phase.id === "verifiers")?.evidenceIds
      ).toHaveLength(4);
      expect(result.run.evidenceIds.length).toBeGreaterThanOrEqual(6);
      expect(result.run.evidenceTiers).toContain("local_command");
      expect(result.run.evidenceTiers).toContain("ci_verified");
      expect(result.run.evidenceTypes).toEqual(
        expect.arrayContaining([
          "startup_problem_hypothesis",
          "startup_user_hypothesis",
          "startup_solution_hypothesis",
          "startup_disconfirming"
        ])
      );
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.verdictBlockers).toEqual([]);
      expect(formatStartupReadinessRun(result.run)).toContain("Launch decision:");
      expect(formatStartupReadinessRun(result.run)).toContain(
        "- Requested target: local ready (local_launch_ready)"
      );
      expect(formatStartupReadinessRun(result.run)).toContain("Target boundary:");
      expect(formatStartupReadinessRun(result.run)).toContain(
        "local_launch_ready covers local demo and local operator validation only"
      );
      expect(formatStartupReadinessRun(result.run)).toContain("Guided readiness flow:");
      expect(formatStartupReadinessRun(result.run)).toContain(
        "Next target after local"
      );
      expect(formatStartupReadinessRun(result.run)).toContain("Operator commands:");
      expect(result.run.guidedFlow[0]).toMatchObject({
        id: "next_target",
        status: "next"
      });
      expect(result.run.operatorCommands.map((command) => command.kind)).toEqual([
        "resume",
        "rerun",
        "dashboard",
        "complete_check"
      ]);
      expect(
        result.run.operatorCommands.find((command) => command.kind === "complete_check")
          ?.command
      ).toContain("--target local");
      expect(formatStartupReadinessRun(result.run)).toContain("Evidence summary:");
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
        "## Target Boundary"
      );
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        "## Guided Flow"
      );
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        "it is not public launch clearance"
      );
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        "| Local demo | yes | local_launch_ready |"
      );
      await expect(readFile(decisionJson ?? "", "utf8")).resolves.toContain(
        '"targetReadiness"'
      );
      await expect(readFile(decisionJson ?? "", "utf8")).resolves.toContain(
        '"targetBoundary"'
      );
      await expect(readFile(decisionJson ?? "", "utf8")).resolves.toContain(
        '"guidedFlow"'
      );
      await expect(readFile(decisionJson ?? "", "utf8")).resolves.toContain(
        '"operatorCommands"'
      );
      expect(persisted).toEqual(result.run);
      const readinessEvents = startupReadinessSnapshotEvents(workspace, result.run.id);
      expect(readinessEvents.length).toBeGreaterThan(1);
      expect(readinessEvents.at(-1)).toMatchObject({
        runId: result.run.id,
        status: "completed",
        verdict: "local_launch_ready",
        path: result.path
      });
      expect(
        readinessEvents.some((event) =>
          event.phases.some(
            (phase) => phase.id === "verifiers" && phase.status === "passed"
          )
        )
      ).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("reuses current verifier evidence after a force-build worker failure", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-recover-verifiers-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await writeStartupReadyStableFixture(workspace);
      await git(workspace, "add", ".");
      await git(workspace, "commit", "-m", "initial startup app");
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const readinessRun = await createStartupReadinessRun({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        now: new Date("2026-05-22T01:15:00.000Z")
      });
      markStartupReadyPhasesPassed(readinessRun.run, [
        "onboard",
        "context",
        "measurement"
      ]);
      await writeFile(
        readinessRun.path,
        `${JSON.stringify(readinessRun.run, null, 2)}\n`,
        "utf8"
      );

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));
      const evidenceIds: string[] = [];

      try {
        for (const command of startupReadyVerifierCommandsFixture()) {
          const stored = await storeCommandVerifierEvidence({
            cwd: workspace,
            runsteadRoot: join(workspace, ".runstead"),
            database,
            task: startupReadyVerifierTask(),
            command,
            now: new Date("2026-05-22T01:16:00.000Z")
          });

          evidenceIds.push(stored.evidence.id);
        }
      } finally {
        database.close();
      }

      const result = await runStartupReady({
        cwd: workspace,
        resumeRunId: readinessRun.run.id,
        forceBuild: true,
        maxAttempts: 1,
        workerRunner: () =>
          Promise.resolve({
            stdout: "",
            stderr: "final model request failed",
            exitCode: 1
          }),
        now: new Date("2026-05-22T01:17:00.000Z")
      });
      const buildPhase = result.run.phases.find((phase) => phase.id === "build_mvp");
      const verifierPhase = result.run.phases.find((phase) => phase.id === "verifiers");
      const decisionReport = result.run.reportPaths.find((path) =>
        path.endsWith(`startup-readiness-run-${result.run.id}.md`)
      );
      const dashboard = await buildDashboard({ cwd: workspace });

      expect(result.run.verdict).toBe("local_launch_ready");
      expect(buildPhase?.status).toBe("passed");
      expect(buildPhase?.execution).toMatchObject({
        implementation: "no_change_needed",
        verification: "passed",
        agentCompletion: "failed"
      });
      expect(buildPhase?.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("MVP verified despite agent completion failure"),
          expect.stringContaining("recovered without re-running the agent")
        ])
      );
      expect(buildPhase?.nextAction).toContain("without re-running the agent");
      expect(verifierPhase).toMatchObject({
        status: "passed",
        evidenceIds,
        blockers: []
      });
      expect(verifierPhase?.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("verified despite agent completion failure")
        ])
      );
      await expect(readFile(decisionReport ?? "", "utf8")).resolves.toContain(
        evidenceIds.join(", ")
      );
      expect(result.run.operatorCommands[0]).toMatchObject({
        kind: "recover",
        title: "Recover with verifier-only evaluation"
      });
      expect(dashboard.snapshot.operator.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Recover with verifier-only evaluation",
            status: "ready"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("blocks recovered verifier phase with a precise missing current evidence name", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-missing-recovered-verifier-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await writeStartupReadyStableFixture(workspace);
      await git(workspace, "add", ".");
      await git(workspace, "commit", "-m", "initial startup app");
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const readinessRun = await createStartupReadinessRun({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        now: new Date("2026-05-22T01:18:00.000Z")
      });
      markStartupReadyPhasesPassed(readinessRun.run, [
        "onboard",
        "context",
        "measurement"
      ]);
      await writeFile(
        readinessRun.path,
        `${JSON.stringify(readinessRun.run, null, 2)}\n`,
        "utf8"
      );

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));
      const evidenceIds: string[] = [];

      try {
        for (const command of startupReadyVerifierCommandsFixture().filter(
          (item) => item.name !== "build"
        )) {
          const stored = await storeCommandVerifierEvidence({
            cwd: workspace,
            runsteadRoot: join(workspace, ".runstead"),
            database,
            task: startupReadyVerifierTask(),
            command,
            now: new Date("2026-05-22T01:19:00.000Z")
          });

          evidenceIds.push(stored.evidence.id);
        }
      } finally {
        database.close();
      }

      const result = await runStartupReady({
        cwd: workspace,
        resumeRunId: readinessRun.run.id,
        forceBuild: true,
        maxAttempts: 1,
        workerRunner: () =>
          Promise.resolve({
            stdout: "",
            stderr: "final model request failed",
            exitCode: 1
          }),
        now: new Date("2026-05-22T01:20:00.000Z")
      });
      const verifierPhase = result.run.phases.find((phase) => phase.id === "verifiers");

      expect(verifierPhase).toMatchObject({
        status: "blocked",
        evidenceIds,
        blockers: ["build verifier evidence is missing for current code fingerprint"]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("feeds interactive founder answers into context and measurement evidence", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-interactive-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-interactive-fixture",
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

      await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        interactive: true,
        interactiveAnswers: {
          architecturePrinciple: "Keep todo data offline-first until sync exists.",
          technicalConstraint: "Avoid new runtime dependencies for the MVP.",
          acceptedDebt: "LocalStorage persistence is accepted for launch smoke.",
          activationMetric: "User creates their first todo.",
          retentionMetric: "User returns and completes a todo.",
          day7Metric: "D7 todo users with one completed task.",
          day30Metric: "D30 todo users with one completed task.",
          falsePositiveMetric: "Todo is added but not visible after reload."
        },
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "built interactive MVP fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:18:00.000Z")
      });

      await expect(readFile(join(workspace, "AGENTS.md"), "utf8")).resolves.toContain(
        "Keep todo data offline-first until sync exists."
      );
      await expect(
        readFile(join(workspace, "MEASUREMENT.md"), "utf8")
      ).resolves.toContain("User creates their first todo.");
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
        sourceConnectorEnv: {},
        now: new Date("2026-05-22T01:20:00.000Z")
      });
      const configuredPlan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "production",
        sourceConnectorEnv: {
          GITHUB_TOKEN: "ghs_fixture",
          VERCEL_TOKEN: "vercel_fixture",
          SENTRY_AUTH_TOKEN: "sentry_fixture",
          POSTHOG_API_KEY: "posthog_fixture"
        },
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
          "support or feedback triage evidence is missing",
          "rollback-drill evidence is missing",
          "monitoring-alert evidence is missing",
          "error-budget evidence is missing",
          "migration-validation evidence is missing",
          "real-user traffic-gate evidence is missing",
          "post-launch watch evidence is missing",
          "Remote CI status connector requires GITHUB_TOKEN for production readiness",
          "production deployment provider connector requires one of VERCEL_TOKEN, RENDER_API_KEY for production readiness",
          "Monitoring provider connector requires SENTRY_AUTH_TOKEN for production readiness",
          "Real-user analytics provider connector requires POSTHOG_API_KEY for production readiness"
        ])
      );
      expect(
        plan.sourceConnectors.requirements.map((requirement) => requirement.id)
      ).toEqual([
        "remote-ci",
        "deployment-provider",
        "monitoring-provider",
        "analytics-provider"
      ]);
      expect(plan.sourceConnectors.blockers).toEqual(
        expect.arrayContaining([
          "Remote CI status connector requires GITHUB_TOKEN for production readiness",
          "Real-user analytics provider connector requires POSTHOG_API_KEY for production readiness"
        ])
      );
      expect(configuredPlan.sourceConnectors.blockers).toEqual([]);
      expect(plan.worker).toBe("codex_direct");
      expect(plan.governanceProfile).toBe("governed");
      expect(formatted).toContain("Worker: codex_direct");
      expect(formatted).toContain("Governance profile: governed");
      expect(formatted).toContain("Level 2 native tool proxy path");
      expect(formatted).toContain("Source connectors:");
      expect(formatted).toContain("- remote-ci: blocked");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("loads SDK extension requirements into startup readiness planning", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-extension-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      await mkdir(join(initialized.root, "extensions"), { recursive: true });
      await writeFile(
        join(initialized.root, "extensions", "growth-readiness.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "growth-readiness",
            version: "0.1.0",
            name: "Growth readiness",
            description: "Growth readiness checks for launch.",
            domains: ["ai-native-startup"],
            facets: [
              {
                name: "activation-metric",
                title: "Activation metric",
                description: "Activation evidence is required before launch.",
                appliesToTargets: ["local"],
                requiredEvidenceTypes: ["startup_metric_snapshot"]
              }
            ],
            gates: [
              {
                id: "local-growth",
                stage: "launch",
                target: "local",
                requiredFacets: ["activation-metric"]
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const plan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        now: new Date("2026-05-22T01:20:30.000Z")
      });
      const launchReport = plan.phases.find((phase) => phase.id === "launch_report");
      const formatted = formatStartupReadyPlan(plan);

      expect(plan.extensions.loaded).toEqual(["growth-readiness"]);
      expect(launchReport?.blockers).toEqual(
        expect.arrayContaining([
          "extension growth-readiness/activation-metric requires startup_metric_snapshot evidence"
        ])
      );
      expect(formatted).toContain("Extensions: growth-readiness");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("treats extension collector safety, quality, and freshness as policy blockers", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-extension-policy-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      await mkdir(join(initialized.root, "extensions"), { recursive: true });
      await writeFile(
        join(initialized.root, "extensions", "growth-policy.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "growth-policy",
            version: "0.1.0",
            name: "Growth policy",
            description: "Growth collector policy checks.",
            domains: ["ai-native-startup"],
            facets: [
              {
                name: "activation-metric",
                title: "Activation metric",
                description: "Activation evidence is required before launch.",
                appliesToTargets: ["local", "production"],
                requiredEvidenceTypes: ["startup_metric_snapshot"]
              }
            ],
            collectors: [
              {
                id: "posthog-activation",
                title: "PostHog activation",
                description: "Collect activation metrics from PostHog.",
                producesEvidenceTypes: ["startup_metric_snapshot"],
                safeForWrappedWorkers: false,
                qualityTier: "self_reported"
              }
            ],
            gates: [
              {
                id: "local-growth",
                stage: "launch",
                target: "local",
                requiredFacets: ["activation-metric"]
              },
              {
                id: "production-growth",
                stage: "launch",
                target: "production",
                requiredFacets: ["activation-metric"]
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const localPlan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        now: new Date("2026-05-22T01:20:45.000Z")
      });
      const productionPlan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "production",
        worker: "codex_direct",
        governanceProfile: "governed",
        now: new Date("2026-05-22T01:20:45.000Z")
      });

      expect(
        localPlan.phases.find((phase) => phase.id === "launch_report")?.blockers
      ).toEqual(
        expect.arrayContaining([
          "extension growth-policy/posthog-activation is not safe for Level 1 wrapped workers; use --worker codex_direct --governance governed"
        ])
      );
      expect(
        productionPlan.phases.find((phase) => phase.id === "launch_report")?.blockers
      ).toEqual(
        expect.arrayContaining([
          "extension growth-policy/posthog-activation quality self_reported is below external_observed for production readiness",
          "extension growth-policy/posthog-activation must declare defaultFreshnessDays for production readiness"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("excludes stale extension evidence from readiness planning", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-extension-freshness-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      await mkdir(join(initialized.root, "extensions"), { recursive: true });
      await writeFile(
        join(initialized.root, "extensions", "growth-freshness.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "growth-freshness",
            version: "0.1.0",
            name: "Growth freshness",
            description: "Growth freshness checks.",
            domains: ["ai-native-startup"],
            facets: [
              {
                name: "activation-metric",
                title: "Activation metric",
                description: "Activation evidence is required before launch.",
                appliesToTargets: ["local"],
                requiredEvidenceTypes: ["startup_metric_snapshot"]
              }
            ],
            gates: [
              {
                id: "local-growth",
                stage: "launch",
                target: "local",
                requiredFacets: ["activation-metric"]
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await addStartupEvidence({
        cwd: workspace,
        type: "metric_snapshot",
        summary: "Old activation metric",
        sources: [
          {
            kind: "analytics",
            uri: "https://analytics.example/activation",
            capturedAt: "2026-05-01T00:00:00.000Z",
            freshnessDays: 7
          }
        ],
        content: JSON.stringify({
          metric: "activation",
          source: "analytics",
          threshold: 40,
          current: 42
        }),
        now: new Date("2026-05-02T00:00:00.000Z")
      });

      const stalePlan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        now: new Date("2026-05-22T01:21:00.000Z")
      });

      expect(
        stalePlan.phases.find((phase) => phase.id === "launch_report")?.blockers
      ).toEqual(
        expect.arrayContaining([
          "extension growth-freshness/activation-metric requires startup_metric_snapshot evidence"
        ])
      );

      await addStartupEvidence({
        cwd: workspace,
        type: "metric_snapshot",
        summary: "Fresh activation metric",
        sources: [
          {
            kind: "analytics",
            uri: "https://analytics.example/activation",
            capturedAt: "2026-05-22T01:20:00.000Z",
            freshnessDays: 7
          }
        ],
        content: JSON.stringify({
          metric: "activation",
          source: "analytics",
          threshold: 40,
          current: 47
        }),
        now: new Date("2026-05-22T01:21:30.000Z")
      });

      const freshPlan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        now: new Date("2026-05-22T01:22:00.000Z")
      });

      expect(
        freshPlan.phases.find((phase) => phase.id === "launch_report")?.blockers
      ).not.toContain(
        "extension growth-freshness/activation-metric requires startup_metric_snapshot evidence"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("explains first-run context ingest and refresh behavior in plans", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-plan-ingest-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "AGENTS.md"), "# Existing agent guide\n", "utf8");
      await writeFile(
        join(workspace, "MEASUREMENT.md"),
        "# Existing measurement\n",
        "utf8"
      );

      const ingestPlan = await planStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        now: new Date("2026-05-22T01:21:00.000Z")
      });
      const refreshPlan = await planStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        refreshContext: true,
        now: new Date("2026-05-22T01:21:00.000Z")
      });
      const context = ingestPlan.phases.find((phase) => phase.id === "context");
      const measurement = ingestPlan.phases.find((phase) => phase.id === "measurement");
      const formatted = formatStartupReadyPlan(ingestPlan);

      expect(context?.nextAction).toContain("ingest: record existing AGENTS.md");
      expect(measurement?.nextAction).toContain(
        "ingest: record existing MEASUREMENT.md"
      );
      expect(formatted).toContain("next: ingest: record existing AGENTS.md");
      expect(
        refreshPlan.phases.find((phase) => phase.id === "context")?.nextAction
      ).toContain("refresh: regenerate context files");
      expect(
        refreshPlan.phases.find((phase) => phase.id === "measurement")?.nextAction
      ).toContain("refresh: regenerate MEASUREMENT.md");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not rewrite tracked root context JSON during startup ready by default", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-context-json-stable-${process.pid}`
    );
    const trackedJsonFiles = [
      "AGENTS.json",
      "CLAUDE.json",
      "CODEX.json",
      "MEASUREMENT.json"
    ];

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeStartupReadyStableFixture(workspace);
      for (const file of trackedJsonFiles) {
        await writeFile(
          join(workspace, file),
          `${JSON.stringify({ sentinel: file, generatedAt: "tracked" }, null, 2)}\n`,
          "utf8"
        );
      }
      await git(workspace, "init");
      await git(workspace, "config", "user.email", "runstead@example.com");
      await git(workspace, "config", "user.name", "Runstead Test");
      await git(workspace, "add", ".");
      await git(workspace, "commit", "-m", "baseline context json");

      const before = await Promise.all(
        trackedJsonFiles.map((file) => readFile(join(workspace, file), "utf8"))
      );

      await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        refreshContext: true,
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "context JSON stability fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:21:30.000Z")
      });

      const after = await Promise.all(
        trackedJsonFiles.map((file) => readFile(join(workspace, file), "utf8"))
      );
      const jsonStatus = await gitOutput(
        workspace,
        "status",
        "--short",
        "--",
        ...trackedJsonFiles
      );

      expect(after).toEqual(before);
      expect(jsonStatus.trim()).toBe("");
      await expect(
        readFile(
          join(workspace, ".runstead", "startup", "tracked-context", "AGENTS.json"),
          "utf8"
        )
      ).resolves.toContain("startup_agent_context");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("writes tracked root context JSON during startup ready when requested", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-context-json-write-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeStartupReadyStableFixture(workspace);

      await runStartupReady({
        cwd: workspace,
        stage: "mvp",
        target: "local",
        worker: "codex_cli",
        refreshContext: true,
        writeTrackedContext: true,
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "explicit root context JSON fixture",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          }),
        now: new Date("2026-05-22T01:21:45.000Z")
      });

      await expect(readFile(join(workspace, "AGENTS.json"), "utf8")).resolves.toContain(
        "startup_agent_context"
      );
      await expect(
        readFile(join(workspace, "MEASUREMENT.json"), "utf8")
      ).resolves.toContain("startup_measurement_framework");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("keeps local startup readiness on the readiness wrapper profile by default", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-local-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const plan = await planStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        now: new Date("2026-05-22T01:22:00.000Z")
      });

      expect(plan.worker).toBe("codex_cli");
      expect(plan.governanceProfile).toBe("readiness");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed when governed readiness is requested for a wrapped worker", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-governed-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      await expect(
        planStartupReady({
          cwd: workspace,
          stage: "launch",
          target: "local",
          worker: "codex_cli",
          governanceProfile: "governed",
          now: new Date("2026-05-22T01:23:00.000Z")
        })
      ).rejects.toThrow("Governance profile governed requires --worker codex_direct");
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
      expect(formatted).toContain("Governance profile: governed");
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
        "rollback drill evidence is required",
        "observability evidence is required",
        "monitoring alert evidence is required",
        "error budget evidence is required",
        "migration validation evidence is required",
        "real-user traffic gate evidence is required",
        "post-launch watch evidence is required"
      ])
    );
  });

  it("allows production target only with deployment, CI, operations, analytics, and support evidence", () => {
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
    const production = evaluateStartupReadinessVerdict({
      run: {
        target: "production",
        phases
      },
      evidenceTiers: [
        "local_command",
        "synthetic_smoke",
        "ci_verified",
        "production_deployment",
        "real_user_analytics",
        "support_ticket",
        "security_scan"
      ],
      evidenceTypes: [
        "startup_repo_readiness",
        "startup_release_plan",
        "startup_rollback_plan",
        "startup_rollback_drill",
        "startup_observability",
        "startup_monitoring_alerts",
        "startup_error_budget",
        "startup_migration_validation",
        "startup_traffic_gate",
        "startup_post_launch_watch",
        "startup_metric_snapshot",
        "startup_support_triage",
        "startup_security_baseline"
      ]
    });

    expect(production.verdict).toBe("public_launch_ready");
    expect(production.blockers).toEqual([]);
    expect(production.targetReadiness.local.verdict).toBe("local_launch_ready");
    expect(production.targetReadiness.staging.verdict).toBe("staging_launch_blocked");
    expect(production.targetReadiness.staging.blockers).toContain(
      "staging deployment evidence is required"
    );
  });

  it("treats verified MVP worker warnings as a passed build phase", () => {
    expect(startupBuildMvpPhaseExecutionStatus("completed")).toBe("passed");
    expect(startupBuildMvpPhaseExecutionStatus("completed_with_warnings")).toBe(
      "passed"
    );
    expect(
      startupBuildMvpPhaseExecutionStatus("failed", {
        implementation: "applied",
        verification: "passed",
        agentCompletion: "failed"
      })
    ).toBe("passed");
    expect(startupBuildMvpPhaseExecutionStatus("failed")).toBe("failed");
    expect(
      startupBuildMvpPhaseExecutionStatus("failed", {
        implementation: "not_applied",
        verification: "skipped",
        agentCompletion: "failed"
      })
    ).toBe("failed");
  });

  it("loads UI smoke config and executes the launch UI phase", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-ui-${process.pid}`);
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await insertLegacyStartupMetricSnapshot({
        cwd: workspace,
        summary: "Malformed metric snapshot from an earlier manual attempt",
        content: JSON.stringify(
          {
            metric: "local_required_checks_passed",
            source: "manual",
            threshold: 1,
            currentValue: 1
          },
          null,
          2
        ),
        now: new Date("2026-05-22T01:20:00.000Z")
      });
      await addStartupEvidence({
        cwd: workspace,
        type: "migration_plan",
        summary: "Thin migration note missing remediation quality fields",
        content: JSON.stringify(
          {
            owner: "founder"
          },
          null,
          2
        ),
        gate: "launch",
        now: new Date("2026-05-22T01:21:00.000Z")
      });
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
          "    viewports:",
          "      - desktop",
          "      - mobile",
          "    expectText:",
          "      - Todo MVP",
          "      - Add todo",
          "    flow: load todo app",
          ""
        ].join("\n"),
        "utf8"
      );
      let workerCalls = 0;

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        appTemplate: "static-todo",
        appType: "local-first-web",
        maxAttempts: 1,
        workerRunner: () => {
          workerCalls += 1;

          throw new Error("green-path startup ready should skip the MVP worker");
        },
        now: new Date("2026-05-22T01:30:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");
      const completePhase = result.run.phases.find(
        (phase) => phase.id === "complete_check"
      );
      const buildPhase = result.run.phases.find((phase) => phase.id === "build_mvp");

      expect(uiPhase).toMatchObject({
        status: "passed",
        blockers: []
      });
      expect(result.run.scaffoldProfile).toMatchObject({
        id: "static-todo",
        template: "static-todo",
        appType: "local-first-web"
      });
      expect(
        result.run.operatorCommands.find((command) => command.kind === "rerun")?.command
      ).toContain("--app-template static-todo");
      expect(buildPhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "startup", "scaffold-profile.json")
        ])
      );
      expect(buildPhase?.nextAction).toBe(
        "existing MVP verified; skipped worker build"
      );
      expect(workerCalls).toBe(0);
      expect(result.run.verdict).toBe("local_launch_ready");
      expect(result.run.verdictBlockers).toEqual([]);
      expect(uiPhase?.evidenceIds).toHaveLength(2);
      expect(result.run.evidenceTypes).toEqual(
        expect.arrayContaining([
          "startup_metric_snapshot",
          "startup_migration_plan",
          "startup_rollback_plan",
          "startup_observability",
          "startup_release_plan",
          "startup_founder_bottleneck"
        ])
      );
      expect(uiPhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "startup", "ui-smoke.yaml")
        ])
      );
      expect(completePhase).toBeDefined();
      expect(completePhase?.status).toBe("passed");
      expect(completePhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "reports", "startup-complete-product-check.md"),
          join(
            workspace,
            ".runstead",
            "reports",
            "startup-complete-product-check.json"
          ),
          join(
            workspace,
            ".runstead",
            "reports",
            "launch-readiness-ai-native-startup.md"
          ),
          join(
            workspace,
            ".runstead",
            "reports",
            "launch-readiness-ai-native-startup.json"
          ),
          join(workspace, ".runstead", "reports", "runstead-startup-ci-summary.md"),
          join(workspace, ".runstead", "reports", "runstead-startup-ci-summary.json"),
          join(workspace, ".runstead", "dashboard", "index.html"),
          join(workspace, ".runstead", "dashboard", "state.json")
        ])
      );
      expect(
        completePhase?.artifacts.some((artifact) =>
          artifact.includes("ops-diagnostics-")
        )
      ).toBe(true);
      expect(result.run.reportPaths).toEqual(
        expect.arrayContaining(completePhase?.artifacts ?? [])
      );
      const ciSummary = JSON.parse(
        await readFile(
          join(workspace, ".runstead", "reports", "runstead-startup-ci-summary.json"),
          "utf8"
        )
      ) as {
        releaseDecision: {
          status: string;
          readinessVerdict?: string;
        };
      };

      expect(ciSummary.releaseDecision).toMatchObject({
        status: "allow_release",
        readinessVerdict: "local_launch_ready"
      });
      expect(evidenceCount(workspace, "startup_metric_snapshot")).toBeGreaterThan(1);
      expect(evidenceCount(workspace, "startup_migration_plan")).toBeGreaterThan(1);
      await expect(
        latestStartupEvidenceContent(workspace, "startup_metric_snapshot")
      ).resolves.toMatchObject({
        sourceClass: "synthetic_smoke",
        confidence: 0.35,
        launchWeight: 0.25,
        realUserData: false,
        captureMode: "local_command"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("runs a bounded MVP repair once when UI smoke fails", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-ui-repair-${process.pid}`);
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-ui-repair-fixture",
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
        startupReadyUiRepairServer("Todo MVP"),
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
          "      - Todo repaired",
          "    flow: load repaired todo app",
          ""
        ].join("\n"),
        "utf8"
      );
      let workerCalls = 0;
      let repairPrompt = "";

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: async (_command, args) => {
          workerCalls += 1;

          repairPrompt = args.join("\n");
          await writeFile(
            join(workspace, "server.mjs"),
            startupReadyUiRepairServer("Todo MVP Todo repaired"),
            "utf8"
          );

          return {
            stdout: JSON.stringify({
              summary: "repaired UI smoke fixture",
              files_changed: ["server.mjs"],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          };
        },
        now: new Date("2026-05-22T01:35:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");
      const repairArtifact = uiPhase?.artifacts.find((artifact) =>
        artifact.includes("ui-smoke-repair-")
      );

      expect(workerCalls).toBe(1);
      expect(repairPrompt).toContain("Repair the product or UI smoke configuration");
      expect(repairPrompt).toContain('expected text was not visible: "Todo repaired"');
      expect(uiPhase).toMatchObject({
        status: "passed",
        blockers: [],
        nextAction: "automatic UI smoke repair passed; continue launch readiness"
      });
      expect(repairArtifact).toBeDefined();
      await expect(readFile(repairArtifact ?? "", "utf8")).resolves.toContain(
        '"failureCategory": "product_gap"'
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("retries product-gap UI smoke repairs and succeeds on the second attempt", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-ui-repair-second-${process.pid}`
    );
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-ui-repair-second-fixture",
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
        startupReadyUiRepairServer("Todo MVP"),
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
          "      - Todo repaired",
          "    flow: load repaired todo app",
          ""
        ].join("\n"),
        "utf8"
      );
      let workerCalls = 0;

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: async () => {
          workerCalls += 1;
          await writeFile(
            join(workspace, "server.mjs"),
            startupReadyUiRepairServer(
              workerCalls === 1 ? "Todo MVP Todo almost" : "Todo MVP Todo repaired"
            ),
            "utf8"
          );

          return {
            stdout: JSON.stringify({
              summary: `repair attempt ${workerCalls}`,
              files_changed: ["server.mjs"],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          };
        },
        now: new Date("2026-05-22T01:38:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");

      expect(workerCalls).toBe(2);
      expect(uiPhase).toMatchObject({
        status: "passed",
        blockers: [],
        nextAction: "automatic UI smoke repair passed; continue launch readiness"
      });
      expect(uiPhase?.warnings?.join("\n")).toContain("UI smoke repair attempt 2");
      expect(
        uiPhase?.artifacts.filter((artifact) => artifact.includes("ui-smoke-repair-"))
      ).toHaveLength(2);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("stops UI smoke repair when the same failure repeats without a code diff", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-ui-repair-cycle-${process.pid}`
    );
    const port = await availablePort();

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "startup-ready-ui-repair-cycle-fixture",
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
        startupReadyUiRepairServer("Todo MVP"),
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
          "      - Todo repaired",
          "    flow: load repaired todo app",
          ""
        ].join("\n"),
        "utf8"
      );
      let workerCalls = 0;

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        maxAttempts: 1,
        workerRunner: () => {
          workerCalls += 1;

          return Promise.resolve({
            stdout: JSON.stringify({
              summary: "claimed repair without diff",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          });
        },
        now: new Date("2026-05-22T01:39:00.000Z")
      });
      const uiPhase = result.run.phases.find((phase) => phase.id === "ui_smoke");

      expect(workerCalls).toBe(1);
      expect(uiPhase?.status).toBe("blocked");
      expect(uiPhase?.blockers.join("\n")).toContain(
        "repeated failure signature without a code diff"
      );
      expect(uiPhase?.warnings?.join("\n")).toContain("codeChanged=false");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("infers non-empty default UI smoke text from project metadata", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-ui-text-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "@acme/todo-launchpad" }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "index.html"),
        [
          "<!doctype html>",
          "<html>",
          "<head><title>Todo MVP</title></head>",
          "<body><main><h1>Todo MVP</h1><button>Add task</button></main></body>",
          "</html>"
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(workspace, "README.md"), "# Launch Todos\n", "utf8");

      await expect(inferStartupReadyUiSmokeExpectText(workspace)).resolves.toEqual(
        expect.arrayContaining([
          "Todo MVP",
          "Add task",
          "Launch Todos",
          "Todo Launchpad"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("infers todo golden-path UI smoke flow actions", async () => {
    const workspace = join(tmpdir(), `runstead-startup-ready-ui-flow-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, "src"), { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "todo-mvp" }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "src", "App.tsx"),
        "export function App() { return <TodoApp />; }\n",
        "utf8"
      );

      const { inferStartupReadyUiSmokeFlowActions } =
        await import("./startup-ready.js");
      const steps = await inferStartupReadyUiSmokeFlowActions(workspace);

      expect(steps.map((step) => step.type)).toEqual([
        "fill",
        "click",
        "expectText",
        "click",
        "fill",
        "expectText",
        "click",
        "click",
        "expectPersisted"
      ]);
      const firstStep = steps[0];
      expect(firstStep?.type).toBe("fill");
      if (firstStep?.type !== "fill") {
        throw new Error("Expected first inferred UI smoke step to fill todo input");
      }
      expect(firstStep.selectors).toEqual(
        expect.arrayContaining([
          "[data-testid='todo-input']",
          "#todo-input",
          "input[name='todo']"
        ])
      );
      const formSubmitInputSelector =
        "form:has(button[type='submit']) input:not([type='search']):not([aria-label*='search' i]):not([placeholder*='search' i])";
      const addPlaceholderSelector =
        "input[placeholder*='add' i][placeholder*='todo' i]";
      expect(
        steps[0]?.type === "fill"
          ? steps[0].selectors?.indexOf(formSubmitInputSelector)
          : -1
      ).toBeLessThan(
        steps[0]?.type === "fill"
          ? (steps[0].selectors?.indexOf(addPlaceholderSelector) ?? -1)
          : -1
      );
      expect(firstStep.selectors).not.toContain("input[placeholder*='todo' i]");
      expect(firstStep.selectors).not.toContain("input[placeholder*='task' i]");
      const searchStep = steps[4];
      expect(searchStep?.type).toBe("fill");
      if (searchStep?.type !== "fill") {
        throw new Error("Expected fifth inferred UI smoke step to fill todo search");
      }
      expect(searchStep.selectors).toEqual(
        expect.arrayContaining([
          "[data-testid='todo-search']",
          "#todo-search",
          "input[name='search']"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("generates richer static-todo UI smoke workflows", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-ready-static-ui-flow-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead", "startup"), { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "todo-mvp" }, null, 2)}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, "README.md"),
        "# Todo MVP\n\nA local-first todo task app.\n",
        "utf8"
      );
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

      const { defaultStartupReadyUiSmokeConfig, inferStartupReadyUiSmokeFlowActions } =
        await import("./startup-ready.js");
      const steps = await inferStartupReadyUiSmokeFlowActions(workspace);
      const config = await defaultStartupReadyUiSmokeConfig(workspace, "npm run dev");

      expect(steps.map((step) => step.type)).toEqual([
        "fill",
        "click",
        "expectText",
        "click",
        "fill",
        "click",
        "expectText",
        "click",
        "fill",
        "expectText",
        "click",
        "expectText",
        "click",
        "click",
        "expectPersisted",
        "click",
        "expectCount",
        "fill",
        "click",
        "click",
        "click",
        "expectCount"
      ]);
      expect(
        steps.some(
          (step) =>
            step.type === "click" &&
            step.selectors?.includes("[data-testid='edit-todo']")
        )
      ).toBe(true);
      expect(
        steps.some(
          (step) =>
            step.type === "click" &&
            step.selectors?.includes("[data-testid='delete-todo']")
        )
      ).toBe(true);
      expect(
        steps.some(
          (step) =>
            step.type === "click" &&
            step.selectors?.includes("[data-testid='clear-completed']")
        )
      ).toBe(true);
      expect(
        steps.some(
          (step) =>
            step.type === "click" &&
            step.selectors?.includes("[data-testid='filter-completed']")
        )
      ).toBe(true);
      expect(config.checks[0]).toMatchObject({
        name: "home-desktop-product-flow",
        flow: "todo workflow: add, edit, complete, search/filter, delete, clear completed, reload persistence"
      });
      expect(config.checks[0]?.steps).toHaveLength(22);
      expect(config.checks[1]).toMatchObject({
        name: "home-mobile-product-layout",
        viewport: "mobile"
      });
      const mobileStep = config.checks[1]?.steps?.[0];

      expect(mobileStep?.type).toBe("expectNoOverlap");
      if (mobileStep?.type !== "expectNoOverlap") {
        throw new Error("Expected mobile UI smoke to assert non-overlapping controls");
      }
      expect(mobileStep.selectors).toEqual(
        expect.arrayContaining([
          "[data-testid='new-todo-input']",
          "[data-testid='filter-completed']",
          "[data-testid='clear-completed']"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

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

async function latestStartupEvidenceContent(
  workspace: string,
  type: string
): Promise<Record<string, unknown>> {
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    const row = database
      .prepare(
        `
        SELECT uri
        FROM evidence
        WHERE type = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
      )
      .get(type) as { uri: string } | undefined;

    if (row === undefined) {
      throw new Error(`Expected evidence type ${type}`);
    }

    const artifact = JSON.parse(await readFile(fileURLToPath(row.uri), "utf8")) as {
      content?: string;
    };
    const content = JSON.parse(artifact.content ?? "{}") as unknown;

    if (typeof content !== "object" || content === null || Array.isArray(content)) {
      throw new Error(`Expected object content for evidence type ${type}`);
    }

    return content as Record<string, unknown>;
  } finally {
    database.close();
  }
}

function startupReadyUiRepairServer(text: string): string {
  return [
    "import http from 'node:http';",
    `const html = ${JSON.stringify(`<!doctype html><html><head><title>${text}</title></head><body><main><h1>${text}</h1><button>Add todo</button></main></body></html>`)};`,
    "const server = http.createServer((_request, response) => {",
    "  response.writeHead(200, { 'content-type': 'text/html' });",
    "  response.end(html);",
    "});",
    "server.listen(Number(process.env.PORT), '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));"
  ].join("\n");
}

interface StartupReadinessSnapshotEventPayload {
  runId: string;
  status: string;
  verdict: string;
  path: string;
  phases: { id: string; status: string }[];
}

function startupReadinessSnapshotEvents(
  workspace: string,
  runId: string
): StartupReadinessSnapshotEventPayload[] {
  const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

  try {
    const rows = database
      .prepare(
        `
        SELECT payload_json
        FROM events
        WHERE type = 'startup_readiness.run_snapshot'
          AND aggregate_type = 'startup_readiness_run'
          AND aggregate_id = ?
        ORDER BY id ASC
      `
      )
      .all(runId) as { payload_json: string }[];

    return rows.map(
      (row) =>
        JSON.parse(row.payload_json) as unknown as StartupReadinessSnapshotEventPayload
    );
  } finally {
    database.close();
  }
}

async function insertLegacyStartupMetricSnapshot(input: {
  cwd: string;
  summary: string;
  content: string;
  now: Date;
}): Promise<void> {
  const evidenceId = createRunsteadId("ev");
  const eventId = createRunsteadId("evt");
  const createdAt = input.now.toISOString();
  const artifactPath = join(
    input.cwd,
    ".runstead",
    "evidence",
    `startup-metric_snapshot-${evidenceId}.json`
  );
  const artifact = {
    schemaVersion: 1,
    createdAt,
    evidenceType: "metric_snapshot",
    summary: input.summary,
    sourceRefs: [],
    sources: [],
    provenance: {
      recordedBy: "legacy-runstead-test",
      recordedAt: createdAt,
      sourceCount: 0,
      sourceKinds: [],
      captureMode: "manual_seed"
    },
    associations: {
      gate: "launch"
    },
    content: input.content
  };
  const evidence: Evidence = {
    id: evidenceId,
    type: "startup_metric_snapshot",
    subjectType: "startup",
    subjectId: "ai-native-startup",
    uri: pathToFileURL(artifactPath).href,
    summary: input.summary,
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

  await mkdir(join(input.cwd, ".runstead", "evidence"), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const database = openRunsteadDatabase(join(input.cwd, ".runstead", "state.db"));

  try {
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

async function writeStartupReadyStableFixture(workspace: string): Promise<void> {
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify(
      {
        name: "startup-ready-stable-fixture",
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
  await writeFile(join(workspace, "index.html"), "<h1>Todo MVP</h1>\n", "utf8");
  await writeFile(join(workspace, ".gitignore"), ".runstead/\n", "utf8");
  await writeFile(join(workspace, "AGENTS.md"), "# Agent Context\n", "utf8");
  await writeFile(join(workspace, "CLAUDE.md"), "# Claude Context\n", "utf8");
  await writeFile(join(workspace, "CODEX.md"), "# Codex Context\n", "utf8");
  await writeFile(join(workspace, "MEASUREMENT.md"), "# Measurement\n", "utf8");
}

function startupReadyVerifierCommandsFixture(): { name: string; command: string }[] {
  return [
    { name: "test", command: 'node -e "process.exit(0)"' },
    { name: "lint", command: 'node -e "process.exit(0)"' },
    { name: "typecheck", command: 'node -e "process.exit(0)"' },
    { name: "build", command: 'node -e "process.exit(0)"' }
  ];
}

function markStartupReadyPhasesPassed(
  run: StartupReadinessRun,
  phaseIds: string[]
): void {
  const ids = new Set(phaseIds);

  run.phases = run.phases.map((phase) =>
    ids.has(phase.id)
      ? {
          ...phase,
          status: "passed",
          blockers: [],
          nextAction: "test fixture precondition satisfied"
        }
      : phase
  );
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024
  });
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024
  });

  return stdout;
}

function startupReadyVerifierTask(): Task {
  return {
    id: "task_startup_ready_stale_code",
    goalId: "goal_startup_ready_stale_code",
    domain: "ai-native-startup",
    type: "run_mvp_verifiers",
    status: "running",
    priority: "medium",
    attempt: 0,
    maxAttempts: 1,
    input: {},
    verifiers: ["command:test"],
    createdAt: "2026-05-22T01:08:00.000Z",
    updatedAt: "2026-05-22T01:08:00.000Z"
  };
}
