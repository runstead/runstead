import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Evidence, Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";

describe("generateLaunchReadinessReport", () => {
  it("writes a launch readiness report and records an audit event", async () => {
    const workspace = join(tmpdir(), `runstead-launch-report-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "launch-report-fixture",
            private: true,
            packageManager: "pnpm@11.1.1",
            scripts: {
              test: "vitest run",
              lint: "eslint ."
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const verifierTask = created.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );
      const measurementTask = created.generatedTasks.find(
        (task) => task.type === "define_measurement_framework"
      );

      if (verifierTask === undefined || measurementTask === undefined) {
        throw new Error("Expected startup goal to generate verifier and metrics tasks");
      }

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        projectTask(database, {
          ...verifierTask,
          status: "completed",
          updatedAt: "2026-05-14T03:20:00.000Z"
        });
        projectTask(database, {
          ...measurementTask,
          status: "completed",
          updatedAt: "2026-05-14T03:25:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_launch_report_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: verifierTask.id,
          uri: "file:///repo/.runstead/evidence/verifier.json",
          summary: "test: passed; lint: passed",
          createdAt: "2026-05-14T03:21:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_launch_report_metrics_001",
          type: "startup_measurement_framework",
          subjectType: "task",
          subjectId: measurementTask.id,
          uri: "file:///repo/.runstead/evidence/metrics.json",
          summary: "activation and retention metrics defined",
          createdAt: "2026-05-14T03:26:00.000Z"
        });
      } finally {
        database.close();
      }

      const result = await generateLaunchReadinessReport({
        cwd: workspace,
        domain: "ai-native-startup",
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const markdown = await readFile(result.reportPath, "utf8");

      expect(result.status).toBe("blocked");
      expect(result.blockers).toContain("CI configuration is missing");
      expect(result.trustSummary.qualityScore).toBeLessThan(1);
      expect(result.jsonPath).toContain("launch-readiness-ai-native-startup.json");
      expect(markdown).toBe(result.markdown);
      expect(markdown).toContain("# Runstead Launch Readiness Report");
      expect(markdown).toContain("## Trust Summary");
      expect(markdown).toContain("Quality score:");
      expect(markdown).toContain("## Repo Health");
      expect(markdown).toContain("## Verifier Status");
      expect(markdown).toContain("## Governance Boundary");
      expect(markdown).toContain("## Release Blockers");
      expect(markdown).toContain("ev_launch_report_command_001");
      expect(markdown).toContain("measurement framework");

      const auditDatabase = openRunsteadDatabase(initialized.stateDb);

      try {
        const event = auditDatabase
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as
          | {
              type: string;
              aggregate_type: string;
              aggregate_id: string;
              payload_json: string;
            }
          | undefined;

        expect(event).toMatchObject({
          type: "report.generated",
          aggregate_type: "report",
          aggregate_id: "launch_readiness_ai_native_startup"
        });
        expect(JSON.parse(event?.payload_json ?? "{}")).toMatchObject({
          reportType: "launch_readiness",
          domain: "ai-native-startup",
          status: "blocked",
          blockers: result.blockers,
          trustSummary: {
            conclusion: expect.stringContaining("Not launch-ready")
          },
          summary: {
            blockers: result.blockers.length,
            tasks: 4
          }
        });
      } finally {
        auditDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("counts wrapped worker verifier evidence for startup launch readiness", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-launch-report-wrapped-worker-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            name: "launch-report-wrapped-worker-fixture",
            private: true,
            scripts: {
              test: "node test.js",
              lint: "node lint.js",
              typecheck: "node typecheck.js",
              build: "node build.js"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        join(workspace, ".github", "workflows", "ci.yml"),
        "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
        "utf8"
      );

      const initialized = await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const created = await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const verifierTask = created.generatedTasks.find(
        (task) => task.type === "run_mvp_verifiers"
      );

      if (verifierTask === undefined) {
        throw new Error("Expected startup goal to generate verifier task");
      }

      const wrappedWorkerTask: Task = {
        id: "task_wrapped_codex_cli_001",
        goalId: created.goal.id,
        domain: "repo-maintenance",
        type: "local_agent_task",
        status: "completed",
        priority: "medium",
        attempt: 1,
        maxAttempts: 1,
        input: {
          worker: "codex_cli",
          commands: [{ name: "test", command: "npm test" }]
        },
        verifiers: ["command:test"],
        createdAt: "2026-05-14T03:15:00.000Z",
        updatedAt: "2026-05-14T03:20:00.000Z"
      };
      const evidenceDir = join(initialized.root, "evidence");
      const commandArtifactPath = join(evidenceDir, "verifier-wrapped.json");

      await mkdir(evidenceDir, { recursive: true });
      await writeFile(
        commandArtifactPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            result: {
              exitCode: 0,
              timedOut: false,
              forceKilled: false
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        projectTask(database, {
          ...verifierTask,
          status: "failed",
          updatedAt: "2026-05-14T03:19:00.000Z"
        });
        projectTask(database, wrappedWorkerTask);
        projectEvidence(database, {
          id: "ev_wrapped_worker_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: wrappedWorkerTask.id,
          uri: pathToFileURL(commandArtifactPath).href,
          summary: "Codex CLI verifier commands passed",
          createdAt: "2026-05-14T03:21:00.000Z"
        });

        for (const [type, summary, content] of [
          [
            "startup_measurement_framework",
            "measurement framework recorded",
            undefined
          ],
          [
            "startup_metric_snapshot",
            "activation metric snapshot recorded",
            { source: "manual", threshold: 0.5, current: 0.7 }
          ],
          ["startup_repo_readiness", "repo readiness clean", undefined],
          ["startup_security_baseline", "security baseline clean", undefined],
          [
            "startup_migration_plan",
            "migration plan recorded",
            launchQualityContent("migration")
          ],
          [
            "startup_rollback_plan",
            "rollback plan recorded",
            launchQualityContent("rollback")
          ],
          [
            "startup_observability",
            "observability recorded",
            launchQualityContent("observability")
          ],
          [
            "startup_ui_validation",
            "desktop UI validation passed",
            {
              url: "http://localhost:3000",
              viewport: "desktop",
              domStatus: "pass",
              accessibilityStatus: "pass",
              responsiveStatus: "pass",
              criticalFlowStatus: "pass"
            }
          ],
          [
            "startup_founder_bottleneck",
            "founder bottleneck handoff recorded",
            undefined
          ],
          [
            "startup_decision",
            "accepted debt decision recorded",
            {
              decision: "launch_with_accepted_debt",
              reason: "Manual support runbook accepted for beta launch",
              owner: "founder"
            }
          ]
        ] as const) {
          const artifactPath = join(evidenceDir, `${type}.json`);
          const sources =
            type === "startup_metric_snapshot"
              ? [
                  {
                    kind: "posthog",
                    uri: "https://posthog.example/project/1/insights/activation",
                    capturedAt: "2026-05-14T03:22:00.000Z",
                    freshnessDays: 2,
                    hash: "sha256:activation-fixture"
                  }
                ]
              : undefined;

          await writeFile(
            artifactPath,
            `${JSON.stringify(
              {
                schemaVersion: 1,
                ...(sources === undefined ? {} : { sources }),
                ...(content === undefined ? {} : { content: JSON.stringify(content) })
              },
              null,
              2
            )}\n`,
            "utf8"
          );
          projectEvidence(database, {
            id: `ev_${type}`,
            type,
            subjectType: "goal",
            subjectId: created.goal.id,
            uri: pathToFileURL(artifactPath).href,
            summary,
            createdAt: "2026-05-14T03:22:00.000Z"
          });
        }
      } finally {
        database.close();
      }

      const result = await generateLaunchReadinessReport({
        cwd: workspace,
        domain: "ai-native-startup",
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const nextResult = await generateLaunchReadinessReport({
        cwd: workspace,
        domain: "ai-native-startup",
        now: new Date("2026-05-14T12:05:00.000Z")
      });
      const json = await readFile(result.jsonPath, "utf8");

      expect(result.status).toBe("launch_ready");
      expect(result.blockers).toEqual([]);
      expect(result.trustSummary.conclusion).toContain("Launch-ready");
      expect(result.trustSummary.acceptedDebtRegister).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Manual support runbook accepted")
        ])
      );
      expect(nextResult.trustSummary.trend).toMatchObject({
        previousStatus: "launch_ready",
        blockerDelta: 0
      });
      expect(json).toContain('"schemaVersion": 1');
      expect(json).toContain('"trustSummary"');
      expect(result.markdown).toContain("Command evidence records: 1");
      expect(result.markdown).toContain("## Trust Summary");
      expect(result.markdown).toContain("Accepted debt register:");
      expect(result.markdown).toContain("ev_wrapped_worker_command_001");
      expect(result.markdown).toContain("wrapped worker post-run verifier evidence");
      expect(result.markdown).toContain("`codex_direct` is the hard-proxy path");
      expect(result.markdown).toContain("## Evidence Provenance");
      expect(result.markdown).toContain("## Frontend UI Validation");
      expect(result.markdown).toContain("url=http://localhost:3000");
      expect(result.markdown).toContain("source=posthog");
      expect(result.markdown).toContain(
        "https://posthog.example/project/1/insights/activation"
      );
      expect(result.markdown).not.toContain("run_mvp_verifiers is failed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function projectTask(
  database: ReturnType<typeof openRunsteadDatabase>,
  task: Task
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${task.id}`,
      type: "task.updated",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        status: task.status
      },
      createdAt: task.updatedAt
    },
    projection: {
      type: "task",
      value: task
    }
  });
}

function projectEvidence(
  database: ReturnType<typeof openRunsteadDatabase>,
  evidence: Evidence
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${evidence.id}`,
      type: "evidence.recorded",
      aggregateType: "evidence",
      aggregateId: evidence.id,
      payload: {
        evidenceId: evidence.id
      },
      createdAt: evidence.createdAt
    },
    projection: {
      type: "evidence",
      value: evidence
    }
  });
}

function launchQualityContent(type: string): {
  owner: string;
  remediationTask: string;
  acceptanceCriteria: string;
} {
  return {
    owner: "founder",
    remediationTask: `Maintain ${type} evidence before launch`,
    acceptanceCriteria: `${type} evidence is reviewed and current`
  };
}
