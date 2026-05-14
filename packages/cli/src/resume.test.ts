import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { findInterruptedTasks, resumeInterruptedTasks } from "./resume.js";
import { startWorkerRun } from "./runtime-audit.js";
import { claimTask, showTask } from "./tasks.js";

describe("findInterruptedTasks", () => {
  it("detects claimed tasks as interrupted", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-resume-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T07:01:00.000Z")
      });

      const result = findInterruptedTasks({ cwd: workspace });

      expect(result.interruptedTasks).toMatchObject([
        {
          task: {
            id: task.id,
            status: "claimed"
          },
          reason: "claimed_or_running"
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requeues interrupted tasks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-resume-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:10:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      const claimedTask = claimTask({
        cwd: workspace,
        id: task.id,
        now: new Date("2026-05-14T07:11:00.000Z")
      }).task;
      const database = openRunsteadDatabase(goal.stateDb);

      try {
        startWorkerRun({
          database,
          task: claimedTask,
          workerType: "shell_verifier",
          enforcementLevel: "policy_enforced",
          now: new Date("2026-05-14T07:11:30.000Z")
        });
      } finally {
        database.close();
      }

      const result = await resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-14T07:12:00.000Z")
      });
      const stored = showTask({ cwd: workspace, id: task.id }).task;
      const resumedDatabase = openRunsteadDatabase(goal.stateDb);

      try {
        const workerRun = resumedDatabase
          .prepare("SELECT status, output_json FROM worker_runs WHERE task_id = ?")
          .get(task.id) as { status: string; output_json: string };
        const workerOutput = JSON.parse(workerRun.output_json) as {
          summary?: string;
          previousTaskStatus?: string;
        };

        expect(result.requeuedTasks).toHaveLength(1);
        expect(result.failedTasks).toHaveLength(0);
        expect(result.requeuedTasks[0]).toMatchObject({
          task: {
            id: task.id,
            status: "queued",
            updatedAt: "2026-05-14T07:12:00.000Z"
          },
          previousStatus: "claimed"
        });
        expect(stored.status).toBe("queued");
        expect(workerRun.status).toBe("failed");
        expect(workerOutput).toMatchObject({
          summary: "Worker run interrupted during resume",
          previousTaskStatus: "claimed"
        });
      } finally {
        resumedDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails interrupted tasks that reached max attempts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-resume-"));

    try {
      await initRunstead({ cwd: workspace });

      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T07:20:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      const runningTask: Task = {
        ...task,
        status: "running",
        attempt: task.maxAttempts,
        output: {
          commands: [
            {
              verifier: "test",
              evidenceId: "ev_existing"
            }
          ]
        },
        updatedAt: "2026-05-14T07:21:00.000Z"
      };
      const database = openRunsteadDatabase(goal.stateDb);

      try {
        appendEventAndProject(database, {
          event: {
            eventId: `evt_${task.id}_running`,
            type: "task.started",
            aggregateType: "task",
            aggregateId: task.id,
            payload: {
              attempt: runningTask.attempt
            },
            createdAt: runningTask.updatedAt
          },
          projection: {
            type: "task",
            value: runningTask
          }
        });
      } finally {
        database.close();
      }

      const result = await resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-14T07:22:00.000Z")
      });
      const stored = showTask({ cwd: workspace, id: task.id }).task;

      expect(result.requeuedTasks).toHaveLength(0);
      expect(result.failedTasks).toHaveLength(1);
      expect(result.failedTasks[0]).toMatchObject({
        task: {
          id: task.id,
          status: "failed",
          updatedAt: "2026-05-14T07:22:00.000Z"
        },
        previousStatus: "running"
      });
      expect(stored.status).toBe("failed");
      expect(stored.output).toMatchObject({
        summary: "Max attempts reached during resume",
        attempt: task.maxAttempts,
        maxAttempts: task.maxAttempts,
        commands: [
          {
            verifier: "test",
            evidenceId: "ev_existing"
          }
        ]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
