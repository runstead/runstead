import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  createLocalAgentTask,
  isLocalAgentTask,
  LOCAL_AGENT_TASK_TYPE
} from "./local-agent.js";
import { showTask } from "./tasks.js";
import { showGoal } from "./goals.js";

describe("local agent task primitives", () => {
  it("creates a durable local agent goal and task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-"));

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });

      const result = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo and summarize its test commands.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "read-only",
        verifierCommands: [
          {
            name: "test",
            command: "npm test"
          }
        ],
        now: new Date("2026-05-16T08:00:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: result.task.id }).task;
      const storedGoal = showGoal({ cwd: workspace, id: result.goal.id }).goal;

      expect(result.task).toMatchObject({
        type: LOCAL_AGENT_TASK_TYPE,
        status: "queued",
        input: {
          repositoryPath: workspace,
          prompt: "Inspect this repo and summarize its test commands.",
          worker: "codex_direct",
          model: "gpt-5.3-codex",
          mode: "read-only",
          commands: [
            {
              name: "test",
              command: "npm test"
            }
          ]
        },
        verifiers: ["command:test"]
      });
      expect(result.goal.scope).toMatchObject({
        repositoryPath: workspace,
        taskType: LOCAL_AGENT_TASK_TYPE,
        worker: "codex_direct",
        mode: "read-only"
      });
      expect(storedTask).toEqual(result.task);
      expect(storedGoal).toEqual(result.goal);
      expect(isLocalAgentTask(storedTask)).toBe(true);
      expect(result.events.map((event) => event.type)).toEqual([
        "goal.created",
        "task.created"
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects empty prompts before creating state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-"));

    try {
      await initRunstead({ cwd: workspace });

      await expect(
        createLocalAgentTask({
          cwd: workspace,
          prompt: "   "
        })
      ).rejects.toThrow("Local agent prompt is required");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
