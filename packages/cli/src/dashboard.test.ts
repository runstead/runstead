import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { buildDashboard, serveDashboard } from "./dashboard.js";

describe("buildDashboard", () => {
  it("writes a static dashboard and records an audit event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );

      const database = openRunsteadDatabase(stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_repo_001",
            type: "repository.registered",
            aggregateType: "repository",
            aggregateId: "repo_001",
            payload: {
              alias: "service-api"
            },
            createdAt: "2026-05-14T05:30:00.000Z"
          },
          projection: {
            type: "repository",
            value: {
              id: "repo_001",
              alias: "service-api",
              localPath: join(workspace, "service"),
              status: "active",
              tags: [],
              createdAt: "2026-05-14T05:30:00.000Z",
              updatedAt: "2026-05-14T05:30:00.000Z"
            }
          }
        });
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_goal_001",
            type: "goal.created",
            aggregateType: "goal",
            aggregateId: "goal_001",
            payload: {
              title: "Keep service healthy"
            },
            createdAt: "2026-05-14T05:31:00.000Z"
          },
          projection: {
            type: "goal",
            value: {
              id: "goal_001",
              domain: "repo-maintenance",
              title: "Keep service healthy",
              status: "active",
              priority: "medium",
              scope: {
                repositoryAlias: "service-api"
              },
              createdAt: "2026-05-14T05:31:00.000Z",
              updatedAt: "2026-05-14T05:31:00.000Z"
            }
          }
        });
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_task_001",
            type: "task.created",
            aggregateType: "task",
            aggregateId: "task_001",
            payload: {
              goalId: "goal_001"
            },
            createdAt: "2026-05-14T05:32:00.000Z"
          },
          projection: {
            type: "task",
            value: {
              id: "task_001",
              goalId: "goal_001",
              domain: "repo-maintenance",
              type: "run_local_verifiers",
              status: "queued",
              priority: "medium",
              attempt: 0,
              maxAttempts: 1,
              input: {},
              verifiers: [],
              createdAt: "2026-05-14T05:32:00.000Z",
              updatedAt: "2026-05-14T05:32:00.000Z"
            }
          }
        });
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_approval_001",
            type: "approval.requested",
            aggregateType: "approval",
            aggregateId: "appr_001",
            payload: {
              actionId: "act_001"
            },
            createdAt: "2026-05-14T05:33:00.000Z"
          },
          projection: {
            type: "approval",
            value: {
              id: "appr_001",
              policyDecisionId: "poldec_001",
              actionId: "act_001",
              status: "pending",
              risk: "high",
              reason: "External write requires approval",
              createdAt: "2026-05-14T05:33:00.000Z",
              updatedAt: "2026-05-14T05:33:00.000Z"
            }
          }
        });
        database
          .prepare(
            `
            INSERT INTO worker_runs (
              id, task_id, worker_type, status, enforcement_level,
              checkpoint_before, started_at, ended_at, output_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            "wr_dashboard_patch",
            "task_001",
            "codex_direct",
            "completed",
            "hard_proxy_tool_calls",
            null,
            "2026-05-14T05:40:00.000Z",
            "2026-05-14T05:41:00.000Z",
            "{}"
          );
        database
          .prepare(
            `
            INSERT INTO tool_calls (
              id, worker_run_id, task_id, action_type, status,
              policy_decision_id, input_json, output_json, started_at, ended_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            "tool_dashboard_patch",
            "wr_dashboard_patch",
            "task_001",
            "filesystem.patch",
            "completed",
            null,
            "{}",
            JSON.stringify({ filesTouched: ["src/App.tsx", "package.json"] }),
            "2026-05-14T05:40:10.000Z",
            "2026-05-14T05:40:11.000Z"
          );
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_evidence_001",
            type: "evidence.recorded",
            aggregateType: "evidence",
            aggregateId: "ev_ui_dashboard",
            payload: {
              type: "startup_ui_validation"
            },
            createdAt: "2026-05-14T05:42:00.000Z"
          },
          projection: {
            type: "evidence",
            value: {
              id: "ev_ui_dashboard",
              type: "startup_ui_validation",
              subjectType: "startup",
              subjectId: "ai-native-startup",
              uri: join(root, "evidence", "ui-smoke-dom.html"),
              hash: "sha256:dashboard",
              summary: "UI smoke passed",
              createdAt: "2026-05-14T05:42:00.000Z"
            }
          }
        });
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_model_retry",
            type: "model_request.retry",
            aggregateType: "worker_run",
            aggregateId: "wr_dashboard_patch",
            payload: {
              attempt: 2,
              reason: "fetch failed",
              delayMs: 250
            },
            createdAt: "2026-05-14T05:40:30.000Z"
          }
        });
      } finally {
        database.close();
      }

      await mkdir(join(root, "startup", "readiness-runs"), { recursive: true });
      await writeFile(
        join(root, "startup", "readiness-runs", "run_dashboard_blocked.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "run_dashboard_blocked",
            cwd: workspace,
            stage: "launch",
            target: "local",
            worker: "codex_direct",
            status: "blocked",
            verdict: "local_launch_blocked",
            verdictBlockers: ["UI smoke failed"],
            evidenceIds: [],
            evidenceTiers: [],
            evidenceTypes: [],
            reportPaths: [
              join(root, "reports", "startup-readiness-run-run_dashboard_blocked.md")
            ],
            guidedFlow: [],
            operatorCommands: [],
            startedAt: "2026-05-14T05:20:00.000Z",
            completedAt: "2026-05-14T05:25:00.000Z",
            phases: [
              {
                id: "ui_smoke",
                title: "UI smoke",
                status: "failed",
                evidenceIds: [],
                artifacts: [join(root, "evidence", "ui-smoke-failed.html")],
                blockers: ["UI smoke failed"],
                nextAction: "repair UI"
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        join(root, "startup", "readiness-runs", "run_dashboard_ready.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "run_dashboard_ready",
            cwd: workspace,
            stage: "launch",
            target: "local",
            worker: "codex_direct",
            status: "completed",
            verdict: "local_launch_ready",
            verdictBlockers: [],
            evidenceIds: ["ev_ui_dashboard"],
            evidenceTiers: ["synthetic_smoke", "local_command"],
            evidenceTypes: ["startup_ui_validation", "command_output"],
            reportPaths: [
              join(root, "reports", "startup-readiness-run-run_dashboard_ready.md")
            ],
            guidedFlow: [
              {
                id: "next_target",
                title: "Next target after local",
                status: "next",
                resolution: "manual",
                why: "local launch is not public launch",
                nextAction: "collect private beta evidence",
                blockers: []
              }
            ],
            operatorCommands: [
              {
                kind: "resume",
                title: "Resume this readiness run",
                command: `runstead startup ready --cwd ${workspace} --resume run_dashboard_ready`,
                when: "Continue the same run."
              },
              {
                kind: "dashboard",
                title: "Rebuild the local dashboard",
                command: `runstead dashboard build --cwd ${workspace}`,
                when: "Refresh the local dashboard."
              }
            ],
            startedAt: "2026-05-14T05:35:00.000Z",
            completedAt: "2026-05-14T05:45:00.000Z",
            dirtyState: "clean",
            phases: [
              {
                id: "ui_smoke",
                title: "UI smoke",
                status: "passed",
                evidenceIds: ["ev_ui_dashboard"],
                artifacts: [join(root, "evidence", "ui-smoke-dom.html")],
                blockers: [],
                nextAction: "continue launch readiness"
              },
              {
                id: "launch_report",
                title: "Launch report",
                status: "passed",
                evidenceIds: [],
                artifacts: [join(root, "reports", "launch.md")],
                blockers: []
              }
            ]
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await mkdir(join(root, "daemon"), { recursive: true });
      await writeFile(
        join(root, "daemon", "status.json"),
        `${JSON.stringify(
          {
            cwd: workspace,
            pid: 12345,
            tick: 7,
            intervalMs: 30000,
            updatedAt: "2026-05-14T05:59:00.000Z",
            scheduledTasks: 1,
            skippedTasks: 0,
            ranTask: true,
            taskId: "task_001",
            taskType: "ci_repair",
            taskStatus: "waiting_approval",
            ciRepairStatus: "waiting_approval",
            branchName: "runstead/task_001/ci-456",
            approvalId: "appr_dashboard_ci",
            eventId: "evt_daemon_tick"
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await buildDashboard({
        cwd: workspace,
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const html = await readFile(result.htmlPath, "utf8");
      const snapshot = JSON.parse(
        await readFile(result.dataPath, "utf8")
      ) as typeof result.snapshot;
      const operator = JSON.parse(
        await readFile(result.operatorActionsPath, "utf8")
      ) as typeof result.snapshot.operator;

      expect(result.outputDir).toBe(join(root, "dashboard"));
      expect(html).toContain("Runstead Dashboard");
      expect(html).toContain("Operator Console");
      expect(html).toContain("Current run");
      expect(html).toContain("Pending approvals");
      expect(html).toContain("Recommended command");
      expect(html).toContain("Startup Readiness");
      expect(html).toContain("run_dashboard_ready");
      expect(html).toContain("Run comparison");
      expect(html).toContain("run_dashboard_blocked");
      expect(html).toContain("Timeline: Phases");
      expect(html).toContain("Timeline: Worker Runs");
      expect(html).toContain("Timeline: Model Requests");
      expect(html).toContain("Timeline: Tool Calls");
      expect(html).toContain("Timeline: Approvals");
      expect(html).toContain("Timeline: Evidence");
      expect(html).toContain("Timeline: Reports");
      expect(html).toContain("UI smoke artifacts");
      expect(html).toContain("Operator command");
      expect(html).toContain("Guided next step");
      expect(html).toContain("runstead dashboard build --cwd");
      expect(html).toContain("collect private beta evidence");
      expect(html).toContain("src/App.tsx");
      expect(html).toContain("service-api");
      expect(html).toContain("task_001 waiting_approval");
      expect(html).toContain("healthy age=60000ms");
      expect(html).toContain(
        "runstead approval approve-and-resume appr_dashboard_ci --cwd"
      );
      expect(html).toContain("runstead startup ready --stage launch");
      expect(html).toContain(
        "waiting_approval branch=runstead/task_001/ci-456 approval=appr_dashboard_ci"
      );
      expect(snapshot.summary).toEqual({
        repositories: 1,
        activeGoals: 1,
        queuedTasks: 1,
        runningTasks: 0,
        failedTasks: 0,
        pendingApprovals: 1
      });
      expect(snapshot.daemon).toMatchObject({
        available: true,
        tick: 7,
        updatedAt: "2026-05-14T05:59:00.000Z",
        ageMs: 60000,
        stale: false,
        taskId: "task_001",
        taskType: "ci_repair",
        taskStatus: "waiting_approval",
        ciRepairStatus: "waiting_approval",
        branchName: "runstead/task_001/ci-456",
        approvalId: "appr_dashboard_ci",
        eventId: "evt_daemon_tick"
      });
      expect(snapshot.startup).toMatchObject({
        available: true,
        latestRun: {
          id: "run_dashboard_ready",
          verdict: "local_launch_ready",
          uiSmokeArtifacts: [join(root, "evidence", "ui-smoke-dom.html")],
          guidedFlow: [
            {
              id: "next_target",
              nextAction: "collect private beta evidence"
            }
          ],
          operatorCommands: [
            {
              kind: "resume"
            },
            {
              kind: "dashboard"
            }
          ]
        },
        agentPatch: {
          taskId: "task_001",
          filesTouched: ["src/App.tsx", "package.json"]
        },
        status: {
          currentStage: "launch",
          nextAction: {
            command: "runstead startup ready --stage launch"
          }
        }
      });
      expect(snapshot.startup.runComparison).toMatchObject({
        latestCompleted: {
          id: "run_dashboard_ready",
          status: "completed",
          verdict: "local_launch_ready"
        },
        latestBlocked: {
          id: "run_dashboard_blocked",
          status: "blocked",
          verdict: "local_launch_blocked"
        },
        resolvedBlockers: ["UI smoke failed"]
      });
      expect(snapshot.startup.timelineGroups.map((group) => group.group)).toEqual([
        "phases",
        "worker_runs",
        "model_requests",
        "tool_calls",
        "approvals",
        "evidence",
        "reports"
      ]);
      expect(snapshot.operator).toMatchObject({
        recommendedAction: {
          id: "daemon-approval-resume",
          source: "daemon_approval",
          status: "blocked"
        },
        currentRun: {
          id: "run_dashboard_ready",
          status: "completed",
          verdict: "local_launch_ready",
          target: "local"
        },
        pendingApprovals: [
          {
            id: "appr_001",
            risk: "high"
          }
        ],
        staleEvidenceCount: 0
      });
      expect(snapshot.operator.pendingApprovals[0]?.command).toContain(
        "approve-and-resume appr_001"
      );
      expect(typeof snapshot.operator.blockerCount).toBe("number");
      expect(snapshot.operator.recommendedCommand).toContain("approve-and-resume");
      expect(snapshot.operator.actions.map((action) => action.id)).toEqual([
        "daemon-approval-resume",
        "approval-appr_001",
        "startup-next-action",
        "startup-run-command-1",
        "startup-run-command-2"
      ]);
      expect(snapshot.operator.blockerCount).toBeGreaterThan(0);
      expect(operator).toEqual(snapshot.operator);

      const auditDatabase = openRunsteadDatabase(stateDb);

      try {
        const event = auditDatabase
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
        };

        expect(event).toMatchObject({
          type: "dashboard.generated",
          aggregate_type: "dashboard",
          aggregate_id: "local"
        });
        const payload = JSON.parse(event.payload_json) as {
          startup: {
            timelineGroups: {
              group: string;
              items: number;
            }[];
          };
        };

        expect(payload).toMatchObject({
          summary: {
            activeGoals: 1,
            queuedTasks: 1
          },
          daemon: {
            available: true,
            updatedAt: "2026-05-14T05:59:00.000Z",
            ageMs: 60000,
            stale: false
          },
          startup: {
            available: true,
            currentStage: "launch",
            latestRun: {
              id: "run_dashboard_ready",
              verdict: "local_launch_ready"
            },
            agentPatch: {
              taskId: "task_001",
              filesTouched: 2
            },
            runComparison: {
              latestCompleted: "run_dashboard_ready",
              latestBlocked: "run_dashboard_blocked",
              resolvedBlockers: 1
            }
          },
          operator: {
            actions: 5,
            recommendedAction: {
              id: "daemon-approval-resume",
              source: "daemon_approval",
              status: "blocked"
            }
          }
        });
        expect(payload.startup.timelineGroups).toContainEqual({
          group: "phases",
          items: 2
        });
      } finally {
        auditDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("counts dashboard summary from all rows, not only displayed rows", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-counts-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );

      const database = openRunsteadDatabase(stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_goal_many",
            type: "goal.created",
            aggregateType: "goal",
            aggregateId: "goal_many",
            payload: {
              title: "Keep many tasks healthy"
            },
            createdAt: "2026-05-14T05:00:00.000Z"
          },
          projection: {
            type: "goal",
            value: {
              id: "goal_many",
              domain: "repo-maintenance",
              title: "Keep many tasks healthy",
              status: "active",
              priority: "medium",
              scope: {},
              createdAt: "2026-05-14T05:00:00.000Z",
              updatedAt: "2026-05-14T05:00:00.000Z"
            }
          }
        });

        for (let index = 0; index < 60; index += 1) {
          const taskId = `task_many_${index.toString().padStart(2, "0")}`;

          appendEventAndProject(database, {
            event: {
              eventId: `evt_${taskId}`,
              type: "task.created",
              aggregateType: "task",
              aggregateId: taskId,
              payload: {
                goalId: "goal_many"
              },
              createdAt: `2026-05-14T05:${index.toString().padStart(2, "0")}:00.000Z`
            },
            projection: {
              type: "task",
              value: {
                id: taskId,
                goalId: "goal_many",
                domain: "repo-maintenance",
                type: "run_local_verifiers",
                status: "queued",
                priority: "medium",
                attempt: 0,
                maxAttempts: 1,
                input: {},
                verifiers: [],
                createdAt: `2026-05-14T05:${index.toString().padStart(2, "0")}:00.000Z`,
                updatedAt: `2026-05-14T05:${index.toString().padStart(2, "0")}:00.000Z`
              }
            }
          });
        }
      } finally {
        database.close();
      }

      const result = await buildDashboard({
        cwd: workspace,
        now: new Date("2026-05-14T06:10:00.000Z")
      });

      expect(result.snapshot.tasks).toHaveLength(50);
      expect(result.snapshot.summary).toMatchObject({
        activeGoals: 1,
        queuedTasks: 60
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("serves the generated dashboard over local HTTP", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-serve-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(stateDb).close();

      const served = await serveDashboard({
        cwd: workspace,
        host: "127.0.0.1",
        port: 0,
        now: new Date("2026-05-23T02:00:00.000Z")
      });

      try {
        const html = await fetch(served.url);
        const data = await fetch(`${served.url}/state.json`);
        const operatorActions = await fetch(`${served.url}/operator-actions.json`);
        const missing = await fetch(`${served.url}/missing`);

        await expect(html.text()).resolves.toContain("Runstead Dashboard");
        await expect(data.text()).resolves.toContain(
          '"generatedAt": "2026-05-23T02:00:00.000Z"'
        );
        await expect(operatorActions.text()).resolves.toContain(
          '"id": "startup-next-action"'
        );
        expect(missing.status).toBe(404);
        expect(served.port).toBeGreaterThan(0);
      } finally {
        await closeServer(served.server);
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps mutating operator endpoints disabled by default", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-api-off-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(stateDb).close();

      const served = await serveDashboard({
        cwd: workspace,
        host: "127.0.0.1",
        port: 0,
        now: new Date("2026-05-23T02:10:00.000Z")
      });

      try {
        const response = await fetch(`${served.url}/evidence/manual`, {
          method: "POST",
          body: JSON.stringify({
            type: "manual_change",
            summary: "Operator checked launch notes"
          })
        });
        const body = (await response.json()) as { error: string };

        expect(response.status).toBe(404);
        expect(body.error).toBe("operator_api_disabled");
        expect(served.operatorApi).toBeUndefined();
      } finally {
        await closeServer(served.server);
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires operator API session, CSRF, and same-origin checks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-api-auth-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(stateDb).close();

      const served = await serveDashboard({
        cwd: workspace,
        host: "127.0.0.1",
        port: 0,
        enableOperatorApi: true,
        sessionToken: "session-123",
        csrfToken: "csrf-123",
        now: new Date("2026-05-23T02:15:00.000Z")
      });

      try {
        const noAuth = await fetch(`${served.url}/evidence/manual`, {
          method: "POST",
          body: JSON.stringify({ summary: "Manual launch check" })
        });
        const noCsrf = await fetch(`${served.url}/evidence/manual`, {
          method: "POST",
          headers: {
            authorization: "Bearer session-123"
          },
          body: JSON.stringify({ summary: "Manual launch check" })
        });
        const crossOrigin = await fetch(`${served.url}/evidence/manual`, {
          method: "POST",
          headers: {
            authorization: "Bearer session-123",
            "x-runstead-csrf-token": "csrf-123",
            origin: "https://example.invalid"
          },
          body: JSON.stringify({ summary: "Manual launch check" })
        });
        const noAuthBody = (await noAuth.json()) as { error: string };
        const noCsrfBody = (await noCsrf.json()) as { error: string };
        const crossOriginBody = (await crossOrigin.json()) as { error: string };

        expect(served.operatorApi).toMatchObject({
          enabled: true,
          sessionToken: "session-123",
          csrfToken: "csrf-123"
        });
        expect(noAuth.status).toBe(403);
        expect(noAuthBody.error).toBe("invalid_session");
        expect(noCsrf.status).toBe(403);
        expect(noCsrfBody.error).toBe("invalid_csrf");
        expect(crossOrigin.status).toBe(403);
        expect(crossOriginBody.error).toBe("origin_denied");
      } finally {
        await closeServer(served.server);
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("approves pending approvals through the operator API and audits the action", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-dashboard-api-approve-"));
    const root = join(workspace, ".runstead");
    const stateDb = join(root, "state.db");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      const database = openRunsteadDatabase(stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_dashboard_api_approval",
            type: "approval.requested",
            aggregateType: "approval",
            aggregateId: "appr_console",
            payload: {
              actionId: "act_console"
            },
            createdAt: "2026-05-23T02:20:00.000Z"
          },
          projection: {
            type: "approval",
            value: {
              id: "appr_console",
              policyDecisionId: "poldec_console",
              actionId: "act_console",
              status: "pending",
              risk: "medium",
              reason: "Console approval fixture",
              createdAt: "2026-05-23T02:20:00.000Z",
              updatedAt: "2026-05-23T02:20:00.000Z"
            }
          }
        });
      } finally {
        database.close();
      }

      const served = await serveDashboard({
        cwd: workspace,
        host: "127.0.0.1",
        port: 0,
        enableOperatorApi: true,
        sessionToken: "session-approve",
        csrfToken: "csrf-approve",
        now: new Date("2026-05-23T02:21:00.000Z")
      });

      try {
        const response = await fetch(`${served.url}/approvals/appr_console/approve`, {
          method: "POST",
          headers: {
            authorization: "Bearer session-approve",
            "x-runstead-csrf-token": "csrf-approve"
          },
          body: "{}"
        });
        const body = (await response.json()) as {
          ok: boolean;
          result: {
            approvalId: string;
            status: string;
          };
        };

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
          ok: true,
          result: {
            approvalId: "appr_console",
            status: "approved"
          }
        });
      } finally {
        await closeServer(served.server);
      }

      const verified = openRunsteadDatabase(stateDb);

      try {
        const approval = verified
          .prepare("SELECT status FROM approvals WHERE id = ?")
          .get("appr_console") as { status: string };
        const audit = verified
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM events
            WHERE type = 'dashboard.operator_action.completed'
              AND aggregate_id = 'appr_console'
          `
          )
          .get() as { count: number };

        expect(approval.status).toBe("approved");
        expect(audit.count).toBe(1);
      } finally {
        verified.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
        return;
      }

      rejectClose(error);
    });
  });
}
