import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { CodexResponsesRequest } from "./codex-responses-transport.js";
import { initRunstead } from "./init.js";
import {
  createLocalAgentTask,
  formatLocalAgentRunReport,
  formatLocalAgentTaskReport,
  isLocalAgentTask,
  LOCAL_AGENT_TASK_TYPE,
  loadLocalAgentTaskReport,
  localAgentRunExitCode,
  runLocalAgentTask
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

  it("runs a codex_direct read-only local agent task through governed model calls", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-run-"));
    const requests: CodexResponsesRequest[] = [];
    const transport: CodexDirectTransport = {
      createResponse(request) {
        requests.push(request);

        return Promise.resolve({
          id: "resp_local_agent_1",
          status: "completed",
          outputText: "Inspected package metadata; no immediate risks found.",
          toolCalls: [],
          finishReason: "stop",
          outputItems: []
        });
      }
    };

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo and summarize package metadata.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "read-only",
        now: new Date("2026-05-16T08:00:00.000Z")
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport,
        now: new Date("2026-05-16T08:01:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;
      const database = openRunsteadDatabase(created.stateDb);

      try {
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const workerRuns = database
          .prepare("SELECT worker_type, status FROM worker_runs ORDER BY started_at, id")
          .all() as { worker_type: string; status: string }[];

        expect(toolCalls).toHaveLength(2);
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "worker.native.start",
              status: "completed"
            },
            {
              action_type: "model.inference.request",
              status: "completed"
            }
          ])
        );
        expect(workerRuns).toHaveLength(2);
        expect(workerRuns).toEqual(
          expect.arrayContaining([
            {
              worker_type: "local_agent_orchestrator",
              status: "completed"
            },
            {
              worker_type: "codex_direct",
              status: "completed"
            }
          ])
        );
      } finally {
        database.close();
      }

      expect(result.status).toBe("completed");
      expect(result.summary).toBe(
        "Inspected package metadata; no immediate risks found."
      );
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        toolCalls: 0
      });
      expect(result.audit.workerRuns).toEqual(
        expect.arrayContaining([
          {
            name: "codex_direct",
            status: "completed",
            count: 1
          },
          {
            name: "local_agent_orchestrator",
            status: "completed",
            count: 1
          }
        ])
      );
      expect(result.audit.toolCalls).toEqual(
        expect.arrayContaining([
          {
            name: "model.inference.request",
            status: "completed",
            count: 1
          },
          {
            name: "worker.native.start",
            status: "completed",
            count: 1
          }
        ])
      );
      expect(result.audit.policyDecisions).toEqual([
        {
          decision: "allow",
          risk: "medium",
          count: 2
        }
      ]);
      expect(storedTask.status).toBe("completed");
      expect(storedTask.output).toMatchObject({
        summary: "Inspected package metadata; no immediate risks found.",
        worker: "codex_direct",
        model: "gpt-5.3-codex"
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.model).toBe("gpt-5.3-codex");
      const firstInput = requests[0]?.input[0];
      expect(firstInput).toMatchObject({ role: "user" });
      expect(
        firstInput !== undefined && "role" in firstInput && firstInput.role === "user"
          ? firstInput.content
          : ""
      ).toContain("Runstead local-agent mode:");
      expect(formatLocalAgentRunReport(result)).toContain("Runstead agent run");
      expect(formatLocalAgentRunReport(result)).toContain(
        "tool_calls: model.inference.request completed x1"
      );
      expect(localAgentRunExitCode(result)).toBe(0);

      const report = await loadLocalAgentTaskReport({
        cwd: workspace,
        taskId: created.task.id
      });
      expect(formatLocalAgentTaskReport(report)).toContain(
        "Runstead agent report"
      );
      expect(formatLocalAgentTaskReport(report)).toContain(
        "policy_decisions: allow medium x2"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs edit mode with a checkpoint and configured verifiers", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-edit-"));
    const verifierCommand = nodeCommand("process.exit(0)");
    const requests: CodexResponsesRequest[] = [];
    const transport: CodexDirectTransport = {
      createResponse(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            id: "resp_local_agent_edit_1",
            status: "completed",
            outputText: "",
            toolCalls: [
              {
                id: "call_write_readme",
                name: "write_file",
                arguments: JSON.stringify({
                  path: "README.md",
                  content: "# Edited by Runstead\n",
                  createDirs: false
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          });
        }

        return Promise.resolve({
          id: "resp_local_agent_edit_2",
          status: "completed",
          outputText: "Updated README.",
          toolCalls: [],
          finishReason: "stop",
          outputItems: []
        });
      }
    };

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentEditPolicyForTest(workspace, verifierCommand);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Update the README.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "edit",
        verifierCommands: [
          {
            name: "test",
            command: verifierCommand
          }
        ]
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;

      expect(result.status).toBe("completed");
      expect(result.checkpoint?.id).toMatch(/^chk_/);
      expect(result.verifierResults).toEqual([
        expect.objectContaining({
          verifier: "test",
          exitCode: 0,
          timedOut: false
        })
      ]);
      expect(result.summary).toContain("Updated README.");
      expect(result.summary).toContain("Verifiers: All verifier commands passed");
      expect(await readFile(join(workspace, "README.md"), "utf8")).toBe(
        "# Edited by Runstead\n"
      );
      expect(storedTask.status).toBe("completed");
      expect(storedTask.output).toMatchObject({
        checkpointId: result.checkpoint?.id,
        verifierStatus: "completed"
      });
      expect(formatLocalAgentRunReport(result)).toContain(
        `Checkpoint: ${result.checkpoint?.id}`
      );
      expect(formatLocalAgentRunReport(result)).toContain("test: exit=0 evidence=");
      expect(requests).toHaveLength(2);
      expect(result.audit.toolCalls).toEqual(
        expect.arrayContaining([
          {
            name: "checkpoint.create",
            status: "completed",
            count: 1
          },
          {
            name: "filesystem.write",
            status: "completed",
            count: 1
          },
          {
            name: "shell.exec",
            status: "completed",
            count: 1
          }
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

async function allowLocalAgentEditPolicyForTest(
  workspace: string,
  verifierCommand: string
): Promise<void> {
  const policyPath = join(workspace, ".runstead", "policies", "repo-maintenance.yaml");
  const raw = await readFile(policyPath, "utf8");
  const writeAllowed = raw.replace(
    "          - checkpoint.restore\n",
    "          - checkpoint.restore\n          - filesystem.write\n"
  );
  const verifierPattern = JSON.stringify(`^${escapeRegex(verifierCommand)}$`);
  const verifierRule = `  - id: allow_local_agent_edit_test_verifier
    when:
      action_type: shell.exec
      command:
        matches_any:
          - ${verifierPattern}
    decision: allow
    risk: low

`;

  await writeFile(
    policyPath,
    writeAllowed.replace("rules:\n", `rules:\n\n${verifierRule}`),
    "utf8"
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
