import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { runOnce } from "./run.js";

describe("runOnce", () => {
  it("returns no queued task when none exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await expect(runOnce({ cwd: workspace })).resolves.toEqual({
        cwd: workspace,
        ranTask: false,
        reason: "no_queued_task"
      });
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

      await expect(runOnce({ cwd: workspace })).resolves.toMatchObject({
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
