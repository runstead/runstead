import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { runTaskVerifiers } from "./verifier-runner.js";

describe("runTaskVerifiers", () => {
  it("marks a task completed when all verifier commands pass", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-run-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(0)");

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const storedTask = database
          .prepare("SELECT status, attempt, output_json FROM tasks WHERE id = ?")
          .get(task.id) as {
          status: string;
          attempt: number;
          output_json: string;
        };
        const evidenceCount = database
          .prepare("SELECT COUNT(*) AS count FROM evidence WHERE subject_id = ?")
          .get(task.id) as { count: number };

        expect(result.task.status).toBe("completed");
        expect(result.commandResults).toMatchObject([
          {
            verifier: "test",
            exitCode: 0,
            timedOut: false
          }
        ]);
        expect(storedTask.status).toBe("completed");
        expect(storedTask.attempt).toBe(1);
        expect(JSON.parse(storedTask.output_json)).toMatchObject({
          summary: "All verifier commands passed"
        });
        expect(evidenceCount.count).toBe(1);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("marks a task failed when a verifier command fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-run-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(4)");

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:30:00.000Z")
      });

      expect(result.task.status).toBe("failed");
      expect(result.commandResults).toMatchObject([
        {
          verifier: "test",
          exitCode: 4,
          timedOut: false
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs verifiers against a legacy .team workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-team-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(0)");

      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:45:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".team", "state.db"));

      try {
        const storedTask = database
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(task.id) as { status: string };
        const evidence = database
          .prepare("SELECT uri FROM evidence WHERE subject_id = ?")
          .get(task.id) as { uri: string };

        expect(result.task.status).toBe("completed");
        expect(storedTask.status).toBe("completed");
        expect(evidence.uri).toContain("/.team/evidence/");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function createTaskWithCommand(workspace: string, script: string): Promise<Task> {
  await initRunstead({ cwd: workspace });

  const goal = await createGoal({
    cwd: workspace,
    domain: "repo-maintenance",
    now: new Date("2026-05-14T05:30:00.000Z")
  });
  const task = goal.generatedTasks[0];

  if (task === undefined) {
    throw new Error("Expected createGoal to generate run_local_verifiers task");
  }

  const verifierTask: Task = {
    ...task,
    input: {
      commands: [
        {
          name: "test",
          command: nodeCommand(script)
        }
      ]
    },
    verifiers: ["command:test"]
  };
  const database = openRunsteadDatabase(goal.stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_configured`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          commands: verifierTask.input.commands
        },
        createdAt: "2026-05-14T05:31:00.000Z"
      },
      projection: {
        type: "task",
        value: verifierTask
      }
    });
  } finally {
    database.close();
  }

  return verifierTask;
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}
