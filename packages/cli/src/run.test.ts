import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { formatRunOnceReport, runOnce, runOnceExitCode } from "./run.js";

describe("runOnce", () => {
  it("throws before creating state in an uninitialized workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await expect(runOnce({ cwd: workspace })).rejects.toThrow(
        `Runstead is not initialized at ${join(workspace, ".runstead")}`
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns no queued task when none exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await runOnce({ cwd: workspace });

      expect(result).toEqual({
        cwd: workspace,
        ranTask: false,
        reason: "no_queued_task"
      });
      expect(formatRunOnceReport(result)).toBe(
        "Runstead run --once\nStatus: idle\nReason: no queued task"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs the next queued task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      configureTaskCommand(goal.stateDb, {
        ...task,
        input: {
          commands: [
            {
              name: "test",
              command: nodeCommand("process.exit(0)")
            }
          ]
        },
        verifiers: ["command:test"]
      });

      const result = await runOnce({ cwd: workspace });

      expect(result).toMatchObject({
        cwd: workspace,
        ranTask: true,
        task: {
          id: task.id,
          status: "completed"
        },
        commandResults: [
          {
            verifier: "test",
            exitCode: 0,
            timedOut: false
          }
        ]
      });
      expect(formatRunOnceReport(result)).toContain(`Task: ${task.id}`);
      expect(formatRunOnceReport(result)).toContain("test: exit=0 evidence=");
      expect(runOnceExitCode(result)).toBe(0);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns a non-zero exit code for a failed task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:10:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      configureTaskCommand(goal.stateDb, {
        ...task,
        input: {
          commands: [
            {
              name: "test",
              command: nodeCommand("process.exit(5)")
            }
          ]
        },
        verifiers: ["command:test"]
      });

      const result = await runOnce({ cwd: workspace });

      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: task.id,
          status: "failed"
        }
      });
      expect(runOnceExitCode(result)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function configureTaskCommand(stateDb: string, task: Task): void {
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_run_configured`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          commands: task.input.commands
        },
        createdAt: "2026-05-14T08:01:00.000Z"
      },
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}
