import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Evidence, Goal, Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { collectCommandVerifierCodeState } from "./verifier-evidence.js";

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
        projectGoal(database, {
          ...created.goal,
          id: "goal_old_startup",
          title: "Old startup goal",
          createdAt: "2026-05-14T01:00:00.000Z",
          updatedAt: "2026-05-14T02:30:00.000Z"
        });
        projectTask(database, {
          ...measurementTask,
          id: "task_old_goal_blocked",
          goalId: "goal_old_startup",
          status: "blocked",
          updatedAt: "2026-05-14T04:00:00.000Z"
        });
        projectTask(database, {
          ...measurementTask,
          id: "task_old_measurement_blocked",
          status: "blocked",
          updatedAt: "2026-05-14T03:10:00.000Z"
        });
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
      expect(markdown).toContain(
        "CI configuration is missing [source: repo:ci_detection]"
      );
      expect(markdown).toContain("ev_launch_report_command_001");
      expect(markdown).toContain("measurement framework");
      expect(markdown).not.toContain("task_old_goal_blocked");
      expect(markdown).not.toContain("task_old_measurement_blocked");

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
        const payload = JSON.parse(event?.payload_json ?? "{}") as {
          reportType?: string;
          domain?: string;
          status?: string;
          blockers?: string[];
          trustSummary?: {
            conclusion?: string;
          };
          summary?: {
            blockers?: number;
            tasks?: number;
          };
        };

        expect(payload).toMatchObject({
          reportType: "launch_readiness",
          domain: "ai-native-startup",
          status: "blocked",
          blockers: result.blockers,
          summary: {
            blockers: result.blockers.length,
            tasks: 6
          }
        });
        expect(payload.trustSummary?.conclusion).toContain("Not launch-ready");
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
      const contextTask = created.generatedTasks.find(
        (task) => task.type === "generate_agent_context"
      );
      const measurementTask = created.generatedTasks.find(
        (task) => task.type === "define_measurement_framework"
      );
      const repoReadinessTask = created.generatedTasks.find(
        (task) => task.type === "inspect_repo_readiness"
      );

      if (
        verifierTask === undefined ||
        contextTask === undefined ||
        measurementTask === undefined ||
        repoReadinessTask === undefined
      ) {
        throw new Error("Expected startup goal to generate readiness tasks");
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
      const codexDirectTask: Task = {
        ...wrappedWorkerTask,
        id: "task_codex_direct_001",
        input: {
          worker: "codex_direct",
          commands: [{ name: "test", command: "npm test" }]
        }
      };
      const evidenceDir = join(initialized.root, "evidence");
      const commandArtifactPath = join(evidenceDir, "verifier-wrapped.json");
      const currentCodeState = await collectCommandVerifierCodeState(workspace);

      await mkdir(evidenceDir, { recursive: true });
      await writeFile(
        commandArtifactPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            codeState: currentCodeState,
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
        for (const task of [contextTask, measurementTask, repoReadinessTask]) {
          projectTask(database, {
            ...task,
            status: "blocked",
            output: {
              summary: "Superseded by current startup evidence"
            },
            updatedAt: "2026-05-14T03:19:30.000Z"
          });
        }
        projectTask(database, {
          id: "task_stale_startup_remediation_001",
          goalId: created.goal.id,
          domain: "ai-native-startup",
          type: "startup_remediation",
          status: "blocked",
          priority: "medium",
          attempt: 1,
          maxAttempts: 1,
          input: {
            stage: "launch",
            blocker: "measurement framework is missing"
          },
          output: {
            summary: "Superseded by current launch gate evidence"
          },
          verifiers: [],
          createdAt: "2026-05-14T03:18:00.000Z",
          updatedAt: "2026-05-14T03:19:30.000Z"
        });
        projectTask(database, wrappedWorkerTask);
        projectTask(database, codexDirectTask);
        projectEvidence(database, {
          id: "ev_wrapped_worker_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: wrappedWorkerTask.id,
          uri: pathToFileURL(commandArtifactPath).href,
          summary: "Codex CLI verifier commands passed",
          createdAt: "2026-05-14T03:21:00.000Z"
        });
        projectEvidence(database, {
          id: "ev_codex_direct_command_001",
          type: "command_output",
          subjectType: "task",
          subjectId: codexDirectTask.id,
          uri: pathToFileURL(commandArtifactPath).href,
          summary: "Codex Direct verifier commands passed",
          createdAt: "2026-05-14T03:21:30.000Z"
        });

        const staleUiArtifactPath = join(evidenceDir, "startup_ui_validation_old.json");

        await writeFile(
          staleUiArtifactPath,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              content: JSON.stringify({
                url: "http://localhost:3000",
                viewport: "desktop",
                domStatus: "fail",
                accessibilityStatus: "not_run",
                responsiveStatus: "not_run",
                criticalFlowStatus: "fail"
              })
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        projectEvidence(database, {
          id: "ev_startup_ui_validation_old",
          type: "startup_ui_validation",
          subjectType: "goal",
          subjectId: created.goal.id,
          uri: pathToFileURL(staleUiArtifactPath).href,
          summary: "old desktop UI validation failed",
          createdAt: "2026-05-14T03:20:00.000Z"
        });

        for (const [type, summary, content] of [
          ["startup_agent_context", "agent context recorded", undefined],
          [
            "startup_measurement_framework",
            "measurement framework recorded",
            undefined
          ],
          [
            "startup_metric_snapshot",
            "activation metric snapshot recorded",
            {
              metric: "activation",
              source: "PostHog activation funnel",
              threshold: 0.5,
              current: 0.7,
              sourceClass: "analytics_real_user",
              confidence: 0.9,
              launchWeight: 1,
              realUserData: true
            }
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
      expect(result.markdown).toContain("Current command evidence records: 2");
      expect(result.markdown).toContain("Stale command evidence records: 0");
      expect(result.markdown).toContain("## Stale Evidence Appendix");
      expect(result.markdown).toContain("ev_startup_ui_validation_old");
      expect(result.markdown).toContain(
        "superseded by newer evidence for startup_ui_validation:http://localhost:3000:desktop"
      );
      expect(result.markdown).toContain("## Trust Summary");
      expect(result.markdown).toContain("## Metric Evidence Confidence");
      expect(result.markdown).toContain("source_class=analytics_real_user");
      expect(result.markdown).toContain("launch_weight=1");
      expect(result.markdown).toContain("Accepted debt register:");
      expect(result.markdown).toContain("ev_wrapped_worker_command_001");
      expect(result.markdown).toContain("wrapped worker post-run verifier evidence");
      expect(result.markdown).toContain("ev_codex_direct_command_001");
      expect(result.markdown).toContain("codex_direct governed verifier evidence");
      expect(result.markdown).toContain("`codex_direct` is the hard-proxy path");
      expect(result.markdown).toContain("## Evidence Provenance");
      expect(result.markdown).toContain("## Frontend UI Validation");
      expect(result.markdown).toContain("url=http://localhost:3000");
      const uiSection = markdownSection(
        result.markdown,
        "## Frontend UI Validation",
        "## Structured Startup Artifacts"
      );

      expect(uiSection).not.toContain("old desktop UI validation failed");
      expect(result.markdown).toContain("source=posthog");
      expect(result.markdown).toContain(
        "https://posthog.example/project/1/insights/activation"
      );
      expect(result.markdown).not.toContain("run_mvp_verifiers is failed");
      expect(result.markdown).not.toContain("generate_agent_context is blocked");
      expect(result.markdown).not.toContain("define_measurement_framework is blocked");
      expect(result.markdown).not.toContain("inspect_repo_readiness is blocked");
      expect(result.markdown).not.toContain("startup_remediation is blocked");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function markdownSection(markdown: string, start: string, end: string): string {
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end, startIndex + start.length);

  if (startIndex === -1 || endIndex === -1) {
    return "";
  }

  return markdown.slice(startIndex, endIndex);
}

function projectGoal(
  database: ReturnType<typeof openRunsteadDatabase>,
  goal: Goal
): void {
  appendEventAndProject(database, {
    event: {
      eventId: `evt_${goal.id}`,
      type: "goal.updated",
      aggregateType: "goal",
      aggregateId: goal.id,
      payload: {
        status: goal.status
      },
      createdAt: goal.updatedAt
    },
    projection: {
      type: "goal",
      value: goal
    }
  });
}

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
