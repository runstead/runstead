import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { buildDashboard } from "./dashboard.js";

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
      } finally {
        database.close();
      }

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

      expect(result.outputDir).toBe(join(root, "dashboard"));
      expect(html).toContain("Runstead Dashboard");
      expect(html).toContain("Startup Readiness");
      expect(html).toContain("service-api");
      expect(html).toContain("task_001 waiting_approval");
      expect(html).toContain("healthy age=60000ms");
      expect(html).toContain("runstead startup onboard");
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
        status: {
          currentStage: "mvp",
          nextAction: {
            command: "runstead startup onboard"
          }
        }
      });

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
        expect(JSON.parse(event.payload_json)).toMatchObject({
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
            currentStage: "mvp"
          }
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
});
