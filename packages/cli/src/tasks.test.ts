import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { claimTask, listTasks, showTask } from "./tasks.js";

describe("task queries", () => {
  it("lists and shows persisted tasks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-task-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const generatedTask = goal.generatedTasks[0];

      if (generatedTask === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      const task: Task = {
        id: "task_list_show_001",
        goalId: goal.goal.id,
        domain: "repo-maintenance",
        type: "run_local_verifiers",
        status: "queued",
        priority: "medium",
        attempt: 0,
        maxAttempts: 1,
        input: {
          commands: ["pnpm test"]
        },
        verifiers: ["command:test"],
        createdAt: "2026-05-14T03:01:00.000Z",
        updatedAt: "2026-05-14T03:01:00.000Z"
      };
      const database = openRunsteadDatabase(goal.stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: "evt_task_list_show_001",
            type: "task.created",
            aggregateType: "task",
            aggregateId: task.id,
            payload: {
              goalId: task.goalId,
              type: task.type
            },
            createdAt: task.createdAt
          },
          projection: {
            type: "task",
            value: task
          }
        });
      } finally {
        database.close();
      }

      expect(listTasks({ cwd: workspace }).tasks).toEqual([task, generatedTask]);
      expect(listTasks({ cwd: workspace, goalId: "goal_missing" }).tasks).toEqual([]);
      expect(showTask({ cwd: workspace, id: task.id }).task).toEqual(task);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("persists claimed task state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-task-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T03:10:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      const claimed = claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T03:11:00.000Z")
      });
      const stored = showTask({ cwd: workspace, id: task.id }).task;

      expect(claimed.task.status).toBe("claimed");
      expect(claimed.task.updatedAt).toBe("2026-05-14T03:11:00.000Z");
      expect(stored.status).toBe("claimed");
      expect(claimed.event).toMatchObject({
        type: "task.claimed",
        aggregateType: "task",
        aggregateId: task.id
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
