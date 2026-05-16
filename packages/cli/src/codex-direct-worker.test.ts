import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  CODEX_DIRECT_WORKER_KIND,
  codexDirectToolDefinitions,
  runCodexDirectWorker,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import type { CodexResponsesRequest } from "./codex-responses-transport.js";
import { showGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import type { PolicyProfile } from "./policy.js";
import { listTasks } from "./tasks.js";

describe("runCodexDirectWorker", () => {
  it("executes model-requested tools through governed action audit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-direct-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_1",
                name: "write_file",
                arguments: JSON.stringify({
                  path: "src/fix.txt",
                  content: "fixed\n",
                  createDirs: true
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Wrote the file.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const workerRows = database
          .prepare(
            "SELECT worker_type, status FROM worker_runs ORDER BY started_at, id"
          )
          .all() as { worker_type: string; status: string }[];

        expect(result).toMatchObject({
          worker: CODEX_DIRECT_WORKER_KIND,
          status: "completed",
          exitCode: 0,
          toolCalls: 1,
          summary: "Wrote the file."
        });
        expect(await readFile(join(workspace, "src/fix.txt"), "utf8")).toBe("fixed\n");
        expect(toolCalls).toEqual([
          {
            action_type: "model.inference.request",
            status: "completed"
          },
          {
            action_type: "filesystem.write",
            status: "completed"
          },
          {
            action_type: "model.inference.request",
            status: "completed"
          }
        ]);
        expect(workerRows).toEqual([
          {
            worker_type: CODEX_DIRECT_WORKER_KIND,
            status: "completed"
          }
        ]);
        expect(transport.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
          "read_file",
          "write_file",
          "run_command",
          "git_status",
          "git_diff"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns recoverable tool execution errors to the model", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-tool-error-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_missing_file",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "pyproject.toml"
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Missing file handled.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport
        });
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];

        expect(result).toMatchObject({
          status: "completed",
          exitCode: 0,
          toolCalls: 1,
          summary: "Missing file handled."
        });
        expect(toolCalls).toEqual(
          expect.arrayContaining([
            {
              action_type: "model.inference.request",
              status: "completed"
            },
            {
              action_type: "filesystem.read",
              status: "failed"
            }
          ])
        );
        expect(
          toolCalls.filter((call) => call.action_type === "model.inference.request")
        ).toHaveLength(2);
        expect(JSON.stringify(transport.requests[1]?.input)).toContain(
          "pyproject.toml"
        );
        expect(JSON.stringify(transport.requests[1]?.input)).toContain("ENOENT");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("enforces task-scoped staged git diff tool calls", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-staged-diff-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const scopedTask = {
          ...task,
          input: {
            ...task.input,
            gitDiffStaged: true
          }
        };
        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task: scopedTask,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_staged_diff",
                  name: "git_diff",
                  arguments: JSON.stringify({
                    staged: false,
                    path: "src/index.ts"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            },
            {
              outputText: "Reviewed staged diff.",
              toolCalls: [],
              finishReason: "stop",
              outputItems: []
            }
          ])
        });
        const diffCall = database
          .prepare("SELECT output_json FROM tool_calls WHERE action_type = 'git.diff'")
          .get() as { output_json: string };

        expect(result.status).toBe("completed");
        expect(diffCall.output_json).toContain("git diff --staged -- 'src/index.ts'");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails edit-style runs when the tool budget is exhausted", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-tool-budget-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_status",
                name: "git_status",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_diff",
                name: "git_diff",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxToolCalls: 1
        });

        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(1);
        expect(result.toolCalls).toBe(1);
        expect(result.summary).toContain("tool budget exhausted after 1 tool calls");
        expect(result.budget).toMatchObject({
          reason: "tool_calls",
          maxToolCalls: 1,
          toolCalls: 1
        });
        expect(transport.requests).toHaveLength(2);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("asks for a no-tool final summary when budget finalization is enabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-budget-finalize-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_status",
                name: "git_status",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_diff",
                name: "git_diff",
                arguments: "{}"
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          },
          {
            outputText: "Summary from gathered evidence.",
            toolCalls: [],
            finishReason: "stop",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxToolCalls: 1,
          finalizeOnBudget: true
        });

        expect(result.status).toBe("completed");
        expect(result.exitCode).toBe(0);
        expect(result.summary).toBe("Summary from gathered evidence.");
        expect(result.warnings[0]).toContain(
          "tool budget exhausted after 1 tool calls"
        );
        expect(result.budget?.reason).toBe("tool_calls");
        expect(transport.requests).toHaveLength(3);
        expect(transport.requests[2]?.tools).toBeUndefined();
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("stops after too many recoverable tool failures", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-codex-failed-tool-budget-")
    );

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const transport = scriptedTransport([
          {
            outputText: "",
            toolCalls: [
              {
                id: "call_missing_file",
                name: "read_file",
                arguments: JSON.stringify({
                  path: "missing.txt"
                })
              }
            ],
            finishReason: "tool_calls",
            outputItems: []
          }
        ]);
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: allowDirectToolsPolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport,
          maxFailedToolCalls: 1
        });

        expect(result.status).toBe("failed");
        expect(result.toolCalls).toBe(1);
        expect(result.failedToolCalls).toBe(1);
        expect(result.summary).toContain(
          "failed-tool budget exhausted after 1 failed tool calls"
        );
        expect(result.budget).toMatchObject({
          reason: "failed_tool_calls",
          maxFailedToolCalls: 1
        });
        expect(transport.requests).toHaveLength(1);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("stops when a tool call requires approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-approval-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: modelAllowedRepoMaintenancePolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_approval",
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "src/fix.txt",
                    content: "fixed\n"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            }
          ])
        });
        const storedWorkerRun = database
          .prepare("SELECT status, output_json FROM worker_runs WHERE id = ?")
          .get(result.workerRun.id) as { status: string; output_json: string };

        expect(result.status).toBe("waiting_approval");
        expect(result.approval?.id).toMatch(/^appr_/);
        expect(storedWorkerRun.status).toBe("waiting_approval");
        expect(storedWorkerRun.output_json).toContain("filesystem.write");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks denied protected-path writes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-codex-deny-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const task = listTasks({ cwd: workspace }).tasks[0];

        if (task === undefined) {
          throw new Error("Expected generated task");
        }

        const goal = showGoal({ cwd: workspace, id: task.goalId }).goal;
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy: modelAllowedRepoMaintenancePolicy,
          goal,
          task,
          model: "fake-codex",
          evidenceDir: join(initialized.root, "evidence"),
          transport: scriptedTransport([
            {
              outputText: "",
              toolCalls: [
                {
                  id: "call_denied",
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: ".env",
                    content: "TOKEN=secret\n"
                  })
                }
              ],
              finishReason: "tool_calls",
              outputItems: []
            }
          ])
        });
        const deniedToolCall = database
          .prepare(
            "SELECT status FROM tool_calls WHERE action_type = 'filesystem.write'"
          )
          .get() as { status: string };

        expect(result.status).toBe("blocked");
        expect(result.exitCode).toBe(3);
        expect(deniedToolCall.status).toBe("denied");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("defines the expected narrow native tool surface", () => {
    expect(codexDirectToolDefinitions().map((tool) => tool.name)).toEqual([
      "read_file",
      "write_file",
      "run_command",
      "git_status",
      "git_diff"
    ]);
  });
});

const allowDirectToolsPolicy: PolicyProfile = {
  id: "allow_direct_tools_for_test",
  version: 1,
  defaultDecision: "deny",
  defaultRisk: "critical",
  rules: [
    {
      id: "allow_direct_tool_actions",
      when: {
        actionType: [
          "filesystem.read",
          "filesystem.write",
          "shell.exec",
          "git.status",
          "git.diff",
          "model.inference.request"
        ]
      },
      decision: "allow",
      risk: "low"
    }
  ]
};

const modelAllowedRepoMaintenancePolicy: PolicyProfile = {
  id: "model_allowed_repo_maintenance_for_test",
  version: 1,
  defaultDecision: "require_approval",
  defaultRisk: "medium",
  rules: [
    {
      id: "deny_secret_files",
      when: {
        path: {
          matchesAny: [".env", ".env.*", "**/secrets/**", "infra/prod/**"]
        }
      },
      decision: "deny",
      risk: "critical"
    },
    {
      id: "allow_model_inference",
      when: {
        actionType: "model.inference.request"
      },
      decision: "allow",
      risk: "medium"
    }
  ]
};

function scriptedTransport(
  responses: Awaited<ReturnType<CodexDirectTransport["createResponse"]>>[]
): CodexDirectTransport & { requests: CodexResponsesRequest[] } {
  const requests: CodexResponsesRequest[] = [];

  return {
    requests,
    createResponse(request) {
      requests.push(request);
      const response = responses.shift();

      if (response === undefined) {
        throw new Error("No scripted Codex response left");
      }

      return Promise.resolve(response);
    }
  };
}
