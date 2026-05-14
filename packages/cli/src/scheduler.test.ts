import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRunsteadId, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { scheduleDueTasks, formatSchedulerReport } from "./scheduler.js";
import { showTask } from "./tasks.js";

describe("scheduleDueTasks", () => {
  it("creates due recurring tasks and skips active duplicates", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-scheduler-"));

    try {
      await writePackageJson(workspace);
      await initRunstead({ cwd: workspace });

      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      const firstTask = created.generatedTasks[0];

      if (firstTask === undefined) {
        throw new Error("Expected createGoal to generate an initial task");
      }

      completeTask(created.stateDb, firstTask, "2026-05-14T00:05:00.000Z");

      const early = await scheduleDueTasks({
        cwd: workspace,
        now: new Date("2026-05-14T23:00:00.000Z")
      });

      expect(early.scheduledTasks).toEqual([]);
      expect(early.skippedTasks).toEqual([
        expect.objectContaining({
          goalId: created.goal.id,
          type: "run_local_verifiers",
          reason: "not_due",
          dueAt: "2026-05-15T00:00:00.000Z"
        })
      ]);

      const due = await scheduleDueTasks({
        cwd: workspace,
        now: new Date("2026-05-15T00:00:01.000Z")
      });
      const scheduled = due.scheduledTasks[0];

      if (scheduled === undefined) {
        throw new Error("Expected scheduler to create a due task");
      }

      expect(due.scheduledTasks).toHaveLength(1);
      expect(scheduled.goalId).toBe(created.goal.id);
      expect(scheduled.event.type).toBe("task.scheduled");
      expect(scheduled.task.input.schedule).toMatchObject({
        source: "background_scheduler",
        recurrenceType: "run_local_verifiers",
        dueAt: "2026-05-15T00:00:00.000Z",
        lastTaskId: firstTask.id,
        lastTaskStatus: "completed"
      });
      expect(showTask({ cwd: workspace, id: scheduled.task.id }).task.status).toBe(
        "queued"
      );
      expect(formatSchedulerReport(due)).toContain(
        `scheduled ${created.goal.id} run_local_verifiers`
      );

      const duplicate = await scheduleDueTasks({
        cwd: workspace,
        now: new Date("2026-05-15T00:00:01.000Z")
      });

      expect(duplicate.scheduledTasks).toEqual([]);
      expect(duplicate.skippedTasks).toEqual([
        expect.objectContaining({
          goalId: created.goal.id,
          type: "run_local_verifiers",
          reason: "active_task_exists",
          taskId: scheduled.task.id
        })
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("respects explicit default intervals", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-scheduler-"));

    try {
      await writePackageJson(workspace);
      await initRunstead({ cwd: workspace });

      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      const firstTask = created.generatedTasks[0];

      if (firstTask === undefined) {
        throw new Error("Expected createGoal to generate an initial task");
      }

      completeTask(created.stateDb, firstTask, "2026-05-14T00:01:00.000Z");

      const result = await scheduleDueTasks({
        cwd: workspace,
        defaultIntervalMs: 60_000,
        now: new Date("2026-05-14T00:02:00.000Z")
      });

      expect(result.scheduledTasks).toHaveLength(1);
      expect(result.scheduledTasks[0]?.dueAt).toBe("2026-05-14T00:01:00.000Z");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not reschedule recurrences blocked on approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-scheduler-"));

    try {
      await writePackageJson(workspace);
      await initRunstead({ cwd: workspace });

      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      const task = created.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate an initial task");
      }

      updateTaskStatus(created.stateDb, task, {
        status: "waiting_approval",
        updatedAt: "2026-05-14T00:05:00.000Z"
      });

      const result = await scheduleDueTasks({
        cwd: workspace,
        now: new Date("2026-05-16T00:00:00.000Z")
      });

      expect(result.scheduledTasks).toEqual([]);
      expect(result.skippedTasks).toEqual([
        expect.objectContaining({
          goalId: created.goal.id,
          type: "run_local_verifiers",
          reason: "active_task_exists",
          taskId: task.id
        })
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function writePackageJson(workspace: string): Promise<void> {
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      scripts: {
        test: "vitest run",
        lint: "eslint src"
      }
    }),
    "utf8"
  );
}

function completeTask(stateDb: string, task: Task, completedAt: string): void {
  updateTaskStatus(stateDb, task, {
    status: "completed",
    updatedAt: completedAt,
    output: {
      exitCode: 0
    }
  });
}

function updateTaskStatus(
  stateDb: string,
  task: Task,
  update: Pick<Task, "status" | "updatedAt"> & { output?: Task["output"] }
): void {
  const database = openRunsteadDatabase(stateDb);
  const updatedTask: Task = {
    ...task,
    status: update.status,
    ...(update.output === undefined ? {} : { output: update.output }),
    updatedAt: update.updatedAt
  };

  try {
    appendEventAndProject(database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: `task.${update.status}`,
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          source: "scheduler_test"
        },
        createdAt: update.updatedAt
      },
      projection: {
        type: "task",
        value: updatedTask
      }
    });
  } finally {
    database.close();
  }
}
