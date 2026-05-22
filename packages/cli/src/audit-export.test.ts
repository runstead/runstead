import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  exportAuditLog,
  formatAuditReplay,
  formatAuditTimeline,
  replayAuditLifecycle
} from "./audit-export.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";

describe("exportAuditLog", () => {
  it("exports events as ordered JSONL", async () => {
    const workspace = join(tmpdir(), `runstead-audit-export-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:00:00.000Z")
      });

      const outputPath = join(workspace, "audit", "events.jsonl");
      const result = await exportAuditLog({
        cwd: workspace,
        outputPath
      });
      const written = await readFile(outputPath, "utf8");
      const lines = written.trim().split("\n");
      const first = JSON.parse(lines[0] ?? "{}") as {
        id: number;
        eventId: string;
        type: string;
        payload: unknown;
      };

      expect(result.outputPath).toBe(outputPath);
      expect(result.contents).toBe(written);
      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      expect(lines).toHaveLength(result.entries.length);
      expect(first).toMatchObject({
        id: 1,
        type: "evidence.recorded"
      });
      expect(result.entries.map((entry) => entry.type)).toContain("goal.created");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("filters exported events by type and aggregate", async () => {
    const workspace = join(tmpdir(), `runstead-audit-export-filter-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:30:00.000Z")
      });

      const byType = await exportAuditLog({
        cwd: workspace,
        types: ["goal.created"]
      });
      const byAggregate = await exportAuditLog({
        cwd: workspace,
        aggregateType: "goal",
        aggregateId: created.goal.id
      });

      expect(byType.entries.map((entry) => entry.type)).toEqual(["goal.created"]);
      expect(byAggregate.entries).toHaveLength(1);
      expect(byAggregate.entries[0]).toMatchObject({
        type: "goal.created",
        aggregateType: "goal",
        aggregateId: created.goal.id
      });
      expect(byAggregate.contents.trim()).toBe(JSON.stringify(byAggregate.entries[0]));
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("pushes export filters into SQL before parsing payload JSON", async () => {
    const workspace = join(tmpdir(), `runstead-audit-export-sql-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:45:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        database
          .prepare(
            `
            INSERT INTO events (
              event_id,
              type,
              aggregate_type,
              aggregate_id,
              payload_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            "evt_invalid_unmatched_payload",
            "task.completed",
            "task",
            "task_unmatched",
            "{not-json",
            "2026-05-14T07:46:00.000Z"
          );
      } finally {
        database.close();
      }

      const result = await exportAuditLog({
        cwd: workspace,
        types: ["goal.created"],
        aggregateType: "goal",
        aggregateId: created.goal.id
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        type: "goal.created",
        aggregateId: created.goal.id
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("formats filtered events as a replayable timeline", async () => {
    const workspace = join(tmpdir(), `runstead-audit-timeline-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });

      const result = await exportAuditLog({
        cwd: workspace,
        aggregateType: "goal",
        aggregateId: created.goal.id
      });
      const timeline = formatAuditTimeline(result.entries);

      expect(timeline).toContain("goal.created");
      expect(timeline).toContain(`goal:${created.goal.id}`);
      expect(timeline).toContain("2026-05-14T08:00:00.000Z");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("replays task lifecycle events through worker, tool, policy, and approval ids", async () => {
    const workspace = join(tmpdir(), `runstead-audit-replay-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        for (const event of [
          {
            eventId: "evt_task_created",
            type: "task.created",
            aggregateType: "task",
            aggregateId: "task_ci",
            payload: { taskId: "task_ci", goalId: "goal_ci" },
            createdAt: "2026-05-14T08:00:00.000Z"
          },
          {
            eventId: "evt_worker_started",
            type: "worker_run.started",
            aggregateType: "worker_run",
            aggregateId: "wrun_ci",
            payload: { workerRunId: "wrun_ci", taskId: "task_ci" },
            createdAt: "2026-05-14T08:01:00.000Z"
          },
          {
            eventId: "evt_tool_requested",
            type: "tool_call.requested",
            aggregateType: "tool_call",
            aggregateId: "tool_pr",
            payload: {
              toolCallId: "tool_pr",
              workerRunId: "wrun_ci",
              taskId: "task_ci",
              actionType: "github.pr.create"
            },
            createdAt: "2026-05-14T08:02:00.000Z"
          },
          {
            eventId: "evt_policy",
            type: "policy.decision_recorded",
            aggregateType: "policy_decision",
            aggregateId: "pol_pr",
            payload: {
              decisionId: "pol_pr",
              actionId: "act_pr",
              decision: "require_approval"
            },
            createdAt: "2026-05-14T08:03:00.000Z"
          },
          {
            eventId: "evt_tool_waiting",
            type: "tool_call.waiting_approval",
            aggregateType: "tool_call",
            aggregateId: "tool_pr",
            payload: {
              toolCallId: "tool_pr",
              workerRunId: "wrun_ci",
              taskId: "task_ci",
              policyDecisionId: "pol_pr",
              approvalId: "appr_pr"
            },
            createdAt: "2026-05-14T08:04:00.000Z"
          },
          {
            eventId: "evt_approval",
            type: "approval.requested",
            aggregateType: "approval",
            aggregateId: "appr_pr",
            payload: {
              approvalId: "appr_pr",
              policyDecisionId: "pol_pr",
              actionId: "act_pr"
            },
            createdAt: "2026-05-14T08:05:00.000Z"
          },
          {
            eventId: "evt_unrelated",
            type: "task.completed",
            aggregateType: "task",
            aggregateId: "task_other",
            payload: { taskId: "task_other", status: "completed" },
            createdAt: "2026-05-14T08:06:00.000Z"
          }
        ]) {
          appendEventAndProject(database, { event });
        }
      } finally {
        database.close();
      }

      const result = await replayAuditLifecycle({
        cwd: workspace,
        taskId: "task_ci"
      });
      const replay = formatAuditReplay(result);

      expect(result.entries.map((entry) => entry.eventId)).toEqual([
        "evt_task_created",
        "evt_worker_started",
        "evt_tool_requested",
        "evt_policy",
        "evt_tool_waiting",
        "evt_approval"
      ]);
      expect(result.relatedIds).toEqual(
        expect.arrayContaining([
          "task_ci",
          "wrun_ci",
          "tool_pr",
          "pol_pr",
          "act_pr",
          "appr_pr"
        ])
      );
      expect(replay).toContain("Replay task: task_ci");
      expect(replay).toContain("approval.requested");
      expect(replay).not.toContain("task_other");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
