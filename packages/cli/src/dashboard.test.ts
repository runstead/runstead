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
      expect(html).toContain("service-api");
      expect(snapshot.summary).toEqual({
        repositories: 1,
        activeGoals: 1,
        queuedTasks: 1,
        runningTasks: 0,
        failedTasks: 0,
        pendingApprovals: 1
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
          }
        });
      } finally {
        auditDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
