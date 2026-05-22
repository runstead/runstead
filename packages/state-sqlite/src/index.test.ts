import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RUNSTEAD_SCHEMA_VERSION,
  assertRunsteadDatabasePath,
  appendEventAndProject,
  appendEventsAndProjects,
  formatRunsteadSchemaValidation,
  openRunsteadDatabase,
  readRunsteadDatabasePath,
  validateRunsteadDatabaseSchema
} from "./index.js";

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
          "approvals",
          "worker_runs",
          "tool_calls",
          "memory_records",
          "repositories",
          "events",
          "schema_migrations"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records schema migrations and SQLite user_version", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));
      const migrations = database
        .prepare(
          `
          SELECT version, name, checksum
          FROM schema_migrations
          ORDER BY version ASC
        `
        )
        .all() as { version: number; name: string; checksum: string }[];
      const userVersion = database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };

      database.close();

      expect(migrations).toHaveLength(2);
      expect(migrations[0]).toMatchObject({
        version: 1,
        name: "initial_state_schema"
      });
      expect(migrations[1]).toMatchObject({
        version: 2,
        name: "state_query_indexes"
      });
      expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migrations[1]?.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(userVersion.user_version).toBe(RUNSTEAD_SCHEMA_VERSION);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("creates query indexes for audit and readiness lookups", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[];

      database.close();

      expect(rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "idx_events_type_created_id",
          "idx_events_aggregate_id",
          "idx_tasks_goal_status_updated",
          "idx_tasks_domain_status_updated",
          "idx_evidence_type_created",
          "idx_evidence_subject_type_created",
          "idx_approvals_action_status_updated",
          "idx_approvals_status_updated",
          "idx_tool_calls_task_started",
          "idx_tool_calls_action_status_started",
          "idx_worker_runs_task_status_started"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("validates migration records, user_version, and required indexes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));
      let validation = validateRunsteadDatabaseSchema(database);

      expect(validation.ok).toBe(true);
      expect(formatRunsteadSchemaValidation(validation)).toBe(
        `schema version ${RUNSTEAD_SCHEMA_VERSION}`
      );

      database.exec("DELETE FROM schema_migrations WHERE version = 2");
      database.exec("PRAGMA user_version = 1");
      database.exec("DROP INDEX idx_events_type_created_id");
      validation = validateRunsteadDatabaseSchema(database);

      database.close();

      expect(validation.ok).toBe(false);
      expect(formatRunsteadSchemaValidation(validation)).toContain(
        "missing migrations: 2"
      );
      expect(formatRunsteadSchemaValidation(validation)).toContain(
        "missing indexes: idx_events_type_created_id"
      );
      expect(formatRunsteadSchemaValidation(validation)).toContain(
        "sqlite user_version 1, expected 2"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports and verifies the backing SQLite file identity", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const stateDb = join(workspace, "state.db");
      const otherStateDb = join(workspace, "other.db");
      const database = openRunsteadDatabase(stateDb);

      try {
        expect(readRunsteadDatabasePath(database)).toMatch(/state\.db$/);
        expect(() => assertRunsteadDatabasePath(database, stateDb)).not.toThrow();
        expect(() => assertRunsteadDatabasePath(database, otherStateDb)).toThrow(
          "Runstead database mismatch"
        );
      } finally {
        database.close();
      }
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

  it("appends multiple event/projection pairs in one transaction", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventsAndProjects(database, [
        {
          event: {
            eventId: "evt_batch_goal_created_001",
            type: "goal.created",
            aggregateType: "goal",
            aggregateId: "goal_batch_001",
            payload: { title: "Batch state updates" },
            createdAt: "2026-05-14T03:00:00.000Z"
          },
          projection: {
            type: "goal",
            value: {
              id: "goal_batch_001",
              domain: "repo-maintenance",
              title: "Batch state updates",
              status: "active",
              priority: "medium",
              scope: {},
              createdAt: "2026-05-14T03:00:00.000Z",
              updatedAt: "2026-05-14T03:00:00.000Z"
            }
          }
        },
        {
          event: {
            eventId: "evt_batch_task_created_001",
            type: "task.created",
            aggregateType: "task",
            aggregateId: "task_batch_001",
            payload: { goalId: "goal_batch_001" },
            createdAt: "2026-05-14T03:00:01.000Z"
          },
          projection: {
            type: "task",
            value: {
              id: "task_batch_001",
              goalId: "goal_batch_001",
              domain: "repo-maintenance",
              type: "run_local_verifiers",
              status: "queued",
              priority: "medium",
              attempt: 0,
              maxAttempts: 1,
              input: {},
              verifiers: ["command:test"],
              createdAt: "2026-05-14T03:00:01.000Z",
              updatedAt: "2026-05-14T03:00:01.000Z"
            }
          }
        }
      ]);

      const eventCount = database
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      const task = database
        .prepare("SELECT id, status FROM tasks WHERE id = ?")
        .get("task_batch_001") as { id: string; status: string };

      database.close();

      expect(eventCount.count).toBe(2);
      expect(task).toEqual({
        id: "task_batch_001",
        status: "queued"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rolls back all entries when a batched append fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      expect(() =>
        appendEventsAndProjects(database, [
          {
            event: {
              eventId: "evt_batch_duplicate_001",
              type: "goal.created",
              aggregateType: "goal",
              aggregateId: "goal_rolled_back_001",
              payload: { title: "Should roll back" },
              createdAt: "2026-05-14T03:01:00.000Z"
            },
            projection: {
              type: "goal",
              value: {
                id: "goal_rolled_back_001",
                domain: "repo-maintenance",
                title: "Should roll back",
                status: "active",
                priority: "medium",
                scope: {},
                createdAt: "2026-05-14T03:01:00.000Z",
                updatedAt: "2026-05-14T03:01:00.000Z"
              }
            }
          },
          {
            event: {
              eventId: "evt_batch_duplicate_001",
              type: "task.created",
              aggregateType: "task",
              aggregateId: "task_duplicate_001",
              payload: { goalId: "goal_rolled_back_001" },
              createdAt: "2026-05-14T03:01:01.000Z"
            }
          }
        ])
      ).toThrow();

      const eventCount = database
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      const goalCount = database
        .prepare("SELECT COUNT(*) AS count FROM goals")
        .get() as { count: number };

      database.close();

      expect(eventCount.count).toBe(0);
      expect(goalCount.count).toBe(0);
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

  it("appends an event and updates an approval projection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_approval_requested_001",
          type: "approval.requested",
          aggregateType: "approval",
          aggregateId: "appr_001",
          payload: {
            policyDecisionId: "poldec_001",
            actionId: "act_001"
          },
          createdAt: "2026-05-14T03:08:00.000Z"
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
            requestedBy: "runstead",
            expiresAt: "2026-05-14T04:08:00.000Z",
            createdAt: "2026-05-14T03:08:00.000Z",
            updatedAt: "2026-05-14T03:08:00.000Z"
          }
        }
      });

      const approval = database
        .prepare(
          `
          SELECT id, policy_decision_id, action_id, status, risk, reason,
                 requested_by, expires_at
          FROM approvals
          WHERE id = ?
        `
        )
        .get("appr_001") as {
        id: string;
        policy_decision_id: string;
        action_id: string;
        status: string;
        risk: string;
        reason: string;
        requested_by: string;
        expires_at: string;
      };

      database.close();

      expect(approval).toEqual({
        id: "appr_001",
        policy_decision_id: "poldec_001",
        action_id: "act_001",
        status: "pending",
        risk: "high",
        reason: "External write requires approval",
        requested_by: "runstead",
        expires_at: "2026-05-14T04:08:00.000Z"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("appends events and updates worker run and tool call projections", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_goal_for_worker_001",
          type: "goal.created",
          aggregateType: "goal",
          aggregateId: "goal_worker_001",
          payload: { title: "Keep CI green" },
          createdAt: "2026-05-14T03:09:00.000Z"
        },
        projection: {
          type: "goal",
          value: {
            id: "goal_worker_001",
            domain: "repo-maintenance",
            title: "Keep CI green",
            status: "active",
            priority: "medium",
            scope: {},
            createdAt: "2026-05-14T03:09:00.000Z",
            updatedAt: "2026-05-14T03:09:00.000Z"
          }
        }
      });
      appendEventAndProject(database, {
        event: {
          eventId: "evt_task_for_worker_001",
          type: "task.created",
          aggregateType: "task",
          aggregateId: "task_worker_001",
          payload: { goalId: "goal_worker_001" },
          createdAt: "2026-05-14T03:09:01.000Z"
        },
        projection: {
          type: "task",
          value: {
            id: "task_worker_001",
            goalId: "goal_worker_001",
            domain: "repo-maintenance",
            type: "run_local_verifiers",
            status: "running",
            priority: "medium",
            attempt: 1,
            maxAttempts: 1,
            input: {},
            verifiers: ["command:test"],
            createdAt: "2026-05-14T03:09:01.000Z",
            updatedAt: "2026-05-14T03:09:01.000Z"
          }
        }
      });
      appendEventAndProject(database, {
        event: {
          eventId: "evt_worker_run_started_001",
          type: "worker_run.started",
          aggregateType: "worker_run",
          aggregateId: "wr_001",
          payload: { taskId: "task_worker_001" },
          createdAt: "2026-05-14T03:10:00.000Z"
        },
        projection: {
          type: "workerRun",
          value: {
            id: "wr_001",
            taskId: "task_worker_001",
            workerType: "shell_verifier",
            status: "running",
            enforcementLevel: "policy_enforced",
            startedAt: "2026-05-14T03:10:00.000Z"
          }
        }
      });
      appendEventAndProject(database, {
        event: {
          eventId: "evt_tool_call_completed_001",
          type: "tool_call.completed",
          aggregateType: "tool_call",
          aggregateId: "tc_001",
          payload: { workerRunId: "wr_001" },
          createdAt: "2026-05-14T03:10:05.000Z"
        },
        projection: {
          type: "toolCall",
          value: {
            id: "tc_001",
            workerRunId: "wr_001",
            taskId: "task_worker_001",
            actionType: "shell.exec",
            status: "completed",
            input: {
              command: "pnpm test"
            },
            output: {
              exitCode: 0
            },
            startedAt: "2026-05-14T03:10:00.000Z",
            endedAt: "2026-05-14T03:10:05.000Z"
          }
        }
      });

      const workerRun = database
        .prepare(
          `
          SELECT id, task_id, worker_type, status, enforcement_level, output_json
          FROM worker_runs
          WHERE id = ?
        `
        )
        .get("wr_001") as {
        id: string;
        task_id: string;
        worker_type: string;
        status: string;
        enforcement_level: string;
        output_json: string | null;
      };
      const toolCall = database
        .prepare(
          `
          SELECT id, worker_run_id, task_id, action_type, status, input_json,
                 output_json
          FROM tool_calls
          WHERE id = ?
        `
        )
        .get("tc_001") as {
        id: string;
        worker_run_id: string;
        task_id: string;
        action_type: string;
        status: string;
        input_json: string;
        output_json: string;
      };

      database.close();

      expect(workerRun).toEqual({
        id: "wr_001",
        task_id: "task_worker_001",
        worker_type: "shell_verifier",
        status: "running",
        enforcement_level: "policy_enforced",
        output_json: null
      });
      expect(toolCall).toEqual({
        id: "tc_001",
        worker_run_id: "wr_001",
        task_id: "task_worker_001",
        action_type: "shell.exec",
        status: "completed",
        input_json: JSON.stringify({ command: "pnpm test" }),
        output_json: JSON.stringify({ exitCode: 0 })
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("appends an event and updates a memory projection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_memory_quarantined_001",
          type: "memory.candidate_quarantined",
          aggregateType: "memory",
          aggregateId: "mem_001",
          payload: {
            scope: "repo:acme/app",
            type: "external_claim"
          },
          createdAt: "2026-05-14T05:00:00.000Z"
        },
        projection: {
          type: "memory",
          value: {
            id: "mem_001",
            scope: "repo:acme/app",
            type: "external_claim",
            status: "quarantined",
            confidence: 0.4,
            content: "A GitHub comment claimed the repo uses npm.",
            sourceRefs: ["github:issue-comment/123"],
            provenance: {
              createdBy: "worker:triage"
            },
            createdAt: "2026-05-14T05:00:00.000Z",
            updatedAt: "2026-05-14T05:00:00.000Z",
            conflictsWith: []
          }
        }
      });

      const memory = database
        .prepare(
          `
          SELECT id, scope, type, status, confidence, source_refs_json
          FROM memory_records
          WHERE id = ?
        `
        )
        .get("mem_001") as {
        id: string;
        scope: string;
        type: string;
        status: string;
        confidence: number;
        source_refs_json: string;
      };

      database.close();

      expect(memory).toEqual({
        id: "mem_001",
        scope: "repo:acme/app",
        type: "external_claim",
        status: "quarantined",
        confidence: 0.4,
        source_refs_json: JSON.stringify(["github:issue-comment/123"])
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("appends an event and updates a repository projection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-state-"));

    try {
      const database = openRunsteadDatabase(join(workspace, "state.db"));

      appendEventAndProject(database, {
        event: {
          eventId: "evt_repository_registered_001",
          type: "repository.registered",
          aggregateType: "repository",
          aggregateId: "repo_001",
          payload: {
            alias: "acme/widgets",
            localPath: "/work/widgets"
          },
          createdAt: "2026-05-14T05:30:00.000Z"
        },
        projection: {
          type: "repository",
          value: {
            id: "repo_001",
            alias: "acme/widgets",
            localPath: "/work/widgets",
            remoteUrl: "git@github.com:acme/widgets.git",
            defaultBranch: "main",
            status: "active",
            tags: ["frontend"],
            createdAt: "2026-05-14T05:30:00.000Z",
            updatedAt: "2026-05-14T05:30:00.000Z"
          }
        }
      });

      const repository = database
        .prepare(
          `
          SELECT id, alias, local_path, remote_url, default_branch, status,
                 tags_json
          FROM repositories
          WHERE id = ?
        `
        )
        .get("repo_001") as {
        id: string;
        alias: string;
        local_path: string;
        remote_url: string;
        default_branch: string;
        status: string;
        tags_json: string;
      };

      database.close();

      expect(repository).toEqual({
        id: "repo_001",
        alias: "acme/widgets",
        local_path: "/work/widgets",
        remote_url: "git@github.com:acme/widgets.git",
        default_branch: "main",
        status: "active",
        tags_json: '["frontend"]'
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
