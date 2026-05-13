import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appendEventAndProject, openRunsteadDatabase } from "./index.js";

describe("openRunsteadDatabase", () => {
  it("creates the v0 state tables", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];

      database.close();

      expect(rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "goals",
          "tasks",
          "evidence",
          "policy_decisions",
          "events"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("appendEventAndProject", () => {
  it("appends an event and updates a goal projection in one transaction", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_goal_created_001",
          type: "goal.created",
          aggregateType: "goal",
          aggregateId: "goal_001",
          payload: { title: "Keep CI green" },
          createdAt: "2026-05-13T10:00:00+08:00"
        },
        projection: {
          type: "goal",
          value: {
            id: "goal_001",
            domain: "repo-maintenance",
            title: "Keep CI green",
            status: "active",
            priority: "medium",
            scope: { repositories: ["local"] },
            createdAt: "2026-05-13T10:00:00+08:00",
            updatedAt: "2026-05-13T10:00:00+08:00"
          }
        }
      });

      const eventCount = database
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      const goal = database
        .prepare("SELECT id, status, scope_json FROM goals WHERE id = ?")
        .get("goal_001") as { id: string; status: string; scope_json: string };

      database.close();

      expect(eventCount.count).toBe(1);
      expect(goal).toEqual({
        id: "goal_001",
        status: "active",
        scope_json: JSON.stringify({ repositories: ["local"] })
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("appends an event and updates a policy decision projection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_policy_decision_001",
          type: "policy.decision_recorded",
          aggregateType: "policy_decision",
          aggregateId: "poldec_001",
          payload: {
            actionId: "act_001",
            decision: "require_approval"
          },
          createdAt: "2026-05-14T03:06:00.000Z"
        },
        projection: {
          type: "policyDecision",
          value: {
            id: "poldec_001",
            actionId: "act_001",
            policyId: "policy_repo_maintenance_v1",
            decision: "require_approval",
            risk: "high",
            ruleId: "require_approval_external_write",
            reason: "Matched policy rule require_approval_external_write",
            obligations: [],
            action: {
              actionId: "act_001",
              actionType: "github.pr.create"
            },
            result: {
              decision: "require_approval",
              risk: "high"
            },
            createdAt: "2026-05-14T03:06:00.000Z"
          }
        }
      });

      const decision = database
        .prepare(
          `
          SELECT id, action_id, policy_id, decision, risk, rule_id,
                 obligations_json
          FROM policy_decisions
          WHERE id = ?
        `
        )
        .get("poldec_001") as {
        id: string;
        action_id: string;
        policy_id: string;
        decision: string;
        risk: string;
        rule_id: string;
        obligations_json: string;
      };

      database.close();

      expect(decision).toEqual({
        id: "poldec_001",
        action_id: "act_001",
        policy_id: "policy_repo_maintenance_v1",
        decision: "require_approval",
        risk: "high",
        rule_id: "require_approval_external_write",
        obligations_json: "[]"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rolls back the event when projection update fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      expect(() =>
        appendEventAndProject(database, {
          event: {
            eventId: "evt_task_created_001",
            type: "task.created",
            aggregateType: "task",
            aggregateId: "task_001",
            payload: { goalId: "goal_missing" },
            createdAt: "2026-05-13T10:01:00+08:00"
          },
          projection: {
            type: "task",
            value: {
              id: "task_001",
              goalId: "goal_missing",
              domain: "repo-maintenance",
              type: "run_local_verifiers",
              status: "queued",
              priority: "medium",
              attempt: 0,
              maxAttempts: 1,
              input: {},
              verifiers: ["command:test"],
              createdAt: "2026-05-13T10:01:00+08:00",
              updatedAt: "2026-05-13T10:01:00+08:00"
            }
          }
        })
      ).toThrow();

      const eventCount = database
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      const taskCount = database
        .prepare("SELECT COUNT(*) AS count FROM tasks")
        .get() as { count: number };

      database.close();

      expect(eventCount.count).toBe(0);
      expect(taskCount.count).toBe(0);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
