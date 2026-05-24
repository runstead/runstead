import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRunsteadId, type Evidence, type RunsteadEvent } from "@runstead/core";
import { describe, expect, it } from "vitest";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { initRunstead } from "./init.js";
import { addStartupEvidence } from "./startup-evidence.js";
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
          "post-launch watch evidence is missing"
        ])
      );
      expect(plan.worker).toBe("codex_direct");
      expect(plan.governanceProfile).toBe("governed");
      expect(formatted).toContain("Worker: codex_direct");
      expect(formatted).toContain("Governance profile: governed");
      expect(formatted).toContain("Level 2 native tool proxy path");
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

  it("treats verified MVP worker warnings as a passed build phase", () => {
    expect(startupBuildMvpPhaseExecutionStatus("completed")).toBe("passed");
    expect(startupBuildMvpPhaseExecutionStatus("completed_with_warnings")).toBe(
      "passed"
    );
    expect(startupBuildMvpPhaseExecutionStatus("failed")).toBe("failed");
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

      const result = await runStartupReady({
        cwd: workspace,
        stage: "launch",
        target: "local",
        worker: "codex_cli",
        appTemplate: "static-todo",
        appType: "local-first-web",
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
        result.run.operatorCommands.find((command) => command.kind === "rerun")
          ?.command
      ).toContain("--app-template static-todo");
      expect(buildPhase?.artifacts).toEqual(
        expect.arrayContaining([
          join(workspace, ".runstead", "startup", "scaffold-profile.json")
        ])
      );
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
          join(workspace, ".runstead", "reports", "startup-complete-product-check.json"),
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

          if (workerCalls === 2) {
            repairPrompt = args.join("\n");
            await writeFile(
              join(workspace, "server.mjs"),
              startupReadyUiRepairServer("Todo MVP Todo repaired"),
              "utf8"
            );
          }

          return {
            stdout: JSON.stringify({
              summary:
                workerCalls === 1
                  ? "built launch fixture"
                  : "repaired UI smoke fixture",
              files_changed: workerCalls === 1 ? [] : ["server.mjs"],
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

      expect(workerCalls).toBe(2);
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

    const artifact = JSON.parse(
      await readFile(fileURLToPath(row.uri), "utf8")
    ) as { content?: string };
    const content = JSON.parse(artifact.content ?? "{}") as unknown;

    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content)
    ) {
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
