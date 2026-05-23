import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import type { CodexDirectTransport } from "./codex-direct-worker.js";
import type { CodexResponsesRequest } from "./codex-responses-transport.js";
import { setRunsteadConfigValue } from "./config.js";
import { initRunstead } from "./init.js";
import {
  attachLocalAgentVerifierEvidence,
  createLocalAgentTask,
  formatLocalAgentRunReport,
  formatLocalAgentTaskReportJson,
  formatLocalAgentTaskReportMarkdown,
  formatLocalAgentTaskReport,
  formatLocalAgentUndoReport,
  isLocalAgentTask,
  LOCAL_AGENT_TASK_TYPE,
  loadLocalAgentTaskReport,
  localAgentRunExitCode,
  resolveLocalAgentResumeTarget,
  runLocalAgentTask,
  undoLocalAgentTask
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
        maxTurns: 8,
        maxToolCalls: 8,
        maxFailedToolCalls: 3,
        finalizeOnBudget: true,
        gitDiffStaged: true,
        gitDiffBase: "origin/main",
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
          maxTurns: 8,
          maxToolCalls: 8,
          maxFailedToolCalls: 3,
          finalizeOnBudget: true,
          gitDiffStaged: true,
          gitDiffBase: "origin/main",
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

  it("attaches verifier evidence to queued test triage prompts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-test-"));
    const verifierCommand = nodeCommand("process.exit(5)");

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentVerifierForTest(workspace, verifierCommand);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Triage the failing verifier.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "read-only",
        verifierCommands: [
          {
            name: "test",
            command: verifierCommand
          }
        ]
      });
      const verifierResult = await attachLocalAgentVerifierEvidence({
        cwd: workspace,
        taskId: created.task.id,
        now: new Date("2026-05-16T08:02:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;

      expect(verifierResult.commandResults).toHaveLength(1);
      expect(verifierResult.commandResults[0]).toMatchObject({
        verifier: "test",
        exitCode: 5,
        timedOut: false
      });
      expect(storedTask.status).toBe("queued");
      expect(String(storedTask.input.prompt)).toContain("Runstead verifier evidence:");
      expect(String(storedTask.input.prompt)).toContain("test: exit=5");
      expect(storedTask.input.verifierEvidence).toEqual([
        expect.objectContaining({
          verifier: "test",
          exitCode: 5,
          evidenceId: verifierResult.commandResults[0]?.evidenceId
        })
      ]);
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
          .prepare(
            "SELECT worker_type, status FROM worker_runs ORDER BY started_at, id"
          )
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
        modelProvider: "chatgpt_codex",
        model: "gpt-5.3-codex",
        governance: {
          level: "level_2_native_proxy",
          boundary: "native_tool_proxy",
          hardProxyToolCalls: true,
          internalToolProxy: "runstead_governed_actions",
          policyEnforcement: "per_tool_call"
        }
      });
      expect(
        (
          storedTask.output as {
            governance?: {
              auditedActions?: string[];
            };
          }
        ).governance?.auditedActions
      ).toEqual(
        expect.arrayContaining(["filesystem.read", "shell.exec", "verifier.run"])
      );
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
      expect(formatLocalAgentRunReport(result)).toContain("Provider: chatgpt_codex");
      expect(formatLocalAgentRunReport(result)).toContain(
        "Governance: level_2_native_proxy"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "Tool proxy: runstead_governed_actions (per_tool_call)"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "tool_calls: model.inference.request completed x1"
      );
      expect(localAgentRunExitCode(result)).toBe(0);

      const report = await loadLocalAgentTaskReport({
        cwd: workspace,
        taskId: created.task.id
      });
      expect(formatLocalAgentTaskReport(report)).toContain("Runstead agent report");
      expect(formatLocalAgentTaskReport(report)).toContain("Model summary:");
      expect(formatLocalAgentTaskReport(report)).toContain(
        "governance level: level_2_native_proxy"
      );
      expect(formatLocalAgentTaskReport(report)).toContain("File/tool activity:");
      expect(formatLocalAgentTaskReport(report)).toContain(
        "policy_decisions: allow medium x2"
      );
      expect(JSON.parse(formatLocalAgentTaskReportJson(report))).toMatchObject({
        task: {
          id: created.task.id
        },
        model: {
          provider: "chatgpt_codex",
          model: "gpt-5.3-codex"
        },
        policy: [
          {
            decision: "allow",
            risk: "medium",
            count: 2
          }
        ]
      });
      expect(formatLocalAgentTaskReportMarkdown(report)).toContain("## Model Summary");
      expect(formatLocalAgentTaskReportMarkdown(report)).toContain(
        "## Policy And Approval"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("explains recoverable failed native tool calls in agent reports", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-local-agent-tool-failure-")
    );
    const requests: CodexResponsesRequest[] = [];
    const transport: CodexDirectTransport = {
      createResponse(request) {
        requests.push(request);

        if (requests.length === 1) {
          return Promise.resolve({
            id: "resp_local_agent_missing_file_1",
            status: "completed",
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
          });
        }

        return Promise.resolve({
          id: "resp_local_agent_missing_file_2",
          status: "completed",
          outputText: "Missing file handled by choosing package metadata instead.",
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
        prompt: "Inspect Python metadata if present.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "read-only"
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport
      });
      const report = await loadLocalAgentTaskReport({
        cwd: workspace,
        taskId: created.task.id
      });
      const reportText = formatLocalAgentTaskReport(report);
      const reportJson = JSON.parse(formatLocalAgentTaskReportJson(report)) as {
        failedToolCalls?: {
          actionType: string;
          status: string;
          failureKind?: string;
          recoverable?: boolean;
        }[];
      };

      expect(result.status).toBe("completed");
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        failedToolCalls: 1
      });
      expect(JSON.stringify(requests[1]?.input)).toContain("ENOENT");
      expect(reportText).toContain("filesystem.read failed pyproject.toml");
      expect(reportText).toContain("failure=missing_file recoverable=yes");
      expect(reportText).toContain("choosing a current path");
      expect(reportJson.failedToolCalls).toEqual([
        expect.objectContaining({
          actionType: "filesystem.read",
          status: "failed",
          failureKind: "missing_file",
          recoverable: true
        })
      ]);
      expect(formatLocalAgentTaskReportMarkdown(report)).toContain(
        "failure=missing_file recoverable=yes"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs a codex_cli read-only local agent task through the wrapped worker", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-codex-cli-"));
    const workerCalls: {
      command: string;
      args: string[];
      cwd: string;
    }[] = [];

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo and summarize package metadata.",
        worker: "codex_cli",
        model: "gpt-5.5",
        mode: "read-only",
        now: new Date("2026-05-16T08:00:00.000Z")
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        workerRunner(command, args, options) {
          workerCalls.push({
            command,
            args,
            cwd: options.cwd
          });

          return Promise.resolve({
            stdout: JSON.stringify({
              summary: "Inspected package metadata through Codex CLI.",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          });
        },
        now: new Date("2026-05-16T08:01:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;
      const database = openRunsteadDatabase(created.stateDb);

      try {
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];

        expect(toolCalls).toEqual([
          {
            action_type: "worker.external.start",
            status: "completed"
          }
        ]);
      } finally {
        database.close();
      }

      expect(result.status).toBe("completed");
      expect(result.summary).toBe("Inspected package metadata through Codex CLI.");
      expect(result.workerResult).toMatchObject({
        worker: "codex_cli",
        command: "codex",
        exitCode: 0,
        outputValidation: {
          valid: true
        }
      });
      expect(workerCalls).toHaveLength(1);
      expect(workerCalls[0]?.command).toBe("codex");
      expect(workerCalls[0]?.args).toEqual([
        "exec",
        "--model",
        "gpt-5.5",
        "--sandbox",
        "workspace-write",
        "--cd",
        workspace,
        expect.stringContaining("Runstead local-agent mode:")
      ]);
      expect(storedTask.status).toBe("completed");
      expect(storedTask.output).toMatchObject({
        summary: "Inspected package metadata through Codex CLI.",
        worker: "codex_cli",
        model: "gpt-5.5",
        modelSource: "runstead_model_option",
        status: "completed",
        governance: {
          level: "level_1_wrapper",
          boundary: "process_wrapper",
          hardProxyToolCalls: false
        },
        outputValidation: {
          valid: true
        }
      });
      expect(formatLocalAgentRunReport(result)).toContain("Worker: codex_cli");
      expect(formatLocalAgentRunReport(result)).toContain("Command: codex");
      expect(formatLocalAgentRunReport(result)).toContain(
        "Tool proxy: none (worker-internal tool calls are not hard-proxied)"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "Governance: level_1_wrapper"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "Model source: runstead_model_option"
      );
      expect(formatLocalAgentRunReport(result)).toContain("Output valid: yes");
      expect(localAgentRunExitCode(result)).toBe(0);

      const report = await loadLocalAgentTaskReport({
        cwd: workspace,
        taskId: created.task.id
      });

      expect(formatLocalAgentTaskReport(report)).toContain("Worker: codex_cli");
      expect(formatLocalAgentTaskReport(report)).toContain("Model: gpt-5.5");
      expect(formatLocalAgentTaskReport(report)).toContain("Worker runtime:");
      expect(formatLocalAgentTaskReport(report)).toContain(
        "hard-proxied tool calls: no"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs a claude_code read-only local agent task through the wrapped worker", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-local-agent-claude-code-")
    );
    const workerCalls: {
      command: string;
      args: string[];
      cwd: string;
    }[] = [];

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo and summarize package metadata.",
        worker: "claude_code",
        model: "sonnet",
        mode: "read-only",
        now: new Date("2026-05-16T08:00:00.000Z")
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        workerRunner(command, args, options) {
          workerCalls.push({
            command,
            args,
            cwd: options.cwd
          });

          return Promise.resolve({
            stdout: JSON.stringify({
              summary: "Inspected package metadata through Claude Code CLI.",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          });
        },
        now: new Date("2026-05-16T08:01:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;
      const database = openRunsteadDatabase(created.stateDb);

      try {
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];

        expect(toolCalls).toEqual([
          {
            action_type: "worker.external.start",
            status: "completed"
          }
        ]);
      } finally {
        database.close();
      }

      expect(result.status).toBe("completed");
      expect(result.summary).toBe(
        "Inspected package metadata through Claude Code CLI."
      );
      expect(result.workerResult).toMatchObject({
        worker: "claude_code",
        command: "claude",
        exitCode: 0,
        outputValidation: {
          valid: true
        }
      });
      expect(workerCalls).toHaveLength(1);
      expect(workerCalls[0]?.command).toBe("claude");
      expect(workerCalls[0]?.args).toEqual([
        "-p",
        "--model",
        "sonnet",
        "--output-format",
        "json",
        "--json-schema",
        expect.stringContaining('"summary"'),
        "--permission-mode",
        "default",
        "--disallowedTools",
        expect.stringContaining("Bash(git push *)"),
        "--",
        expect.stringContaining("Runstead local-agent mode:")
      ]);
      expect(storedTask.status).toBe("completed");
      expect(storedTask.output).toMatchObject({
        summary: "Inspected package metadata through Claude Code CLI.",
        worker: "claude_code",
        model: "sonnet",
        modelSource: "runstead_model_option",
        status: "completed",
        governance: {
          boundary: "process_wrapper",
          hardProxyToolCalls: false
        },
        outputValidation: {
          valid: true
        }
      });
      expect(formatLocalAgentRunReport(result)).toContain("Worker: claude_code");
      expect(formatLocalAgentRunReport(result)).toContain("Command: claude");
      expect(formatLocalAgentRunReport(result)).toContain(
        "Tool proxy: none (worker-internal tool calls are not hard-proxied)"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "Model source: runstead_model_option"
      );
      expect(formatLocalAgentRunReport(result)).toContain("Output valid: yes");
      expect(localAgentRunExitCode(result)).toBe(0);

      const report = await loadLocalAgentTaskReport({
        cwd: workspace,
        taskId: created.task.id
      });

      expect(formatLocalAgentTaskReport(report)).toContain("Worker: claude_code");
      expect(formatLocalAgentTaskReport(report)).toContain("Model: sonnet");
      expect(formatLocalAgentTaskReport(report)).toContain("Worker runtime:");
      expect(formatLocalAgentTaskReport(report)).toContain(
        "hard-proxied tool calls: no"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports the Claude Code CLI default model source when no model is set", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-local-agent-claude-default-model-")
    );
    const workerCalls: { args: string[] }[] = [];

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo and summarize package metadata.",
        worker: "claude_code",
        mode: "read-only",
        now: new Date("2026-05-16T08:00:00.000Z")
      });
      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        workerRunner(_command, args) {
          workerCalls.push({ args });

          return Promise.resolve({
            stdout: JSON.stringify({
              summary: "Inspected package metadata through Claude Code CLI.",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          });
        },
        now: new Date("2026-05-16T08:01:00.000Z")
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;

      expect(workerCalls[0]?.args).not.toContain("--model");
      expect(storedTask.output).toMatchObject({
        worker: "claude_code",
        modelSource: "claude_code_config"
      });
      expect(formatLocalAgentRunReport(result)).toContain(
        "Model: Claude Code CLI default"
      );
      expect(formatLocalAgentRunReport(result)).toContain(
        "Model source: claude_code_config"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses the configured Codex model when the task omits a model", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-model-"));
    const requests: CodexResponsesRequest[] = [];
    const transport: CodexDirectTransport = {
      createResponse(request) {
        requests.push(request);

        return Promise.resolve({
          id: "resp_local_agent_configured_model",
          status: "completed",
          outputText: "Inspected package metadata.",
          toolCalls: [],
          finishReason: "stop",
          outputItems: []
        });
      }
    };

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await setRunsteadConfigValue({
        cwd: workspace,
        key: "codex.model",
        value: "configured-codex"
      });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Inspect this repo.",
        worker: "codex_direct",
        mode: "read-only"
      });

      await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport
      });

      expect(requests[0]?.model).toBe("configured-codex");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs a local agent task through a configured non-Codex provider", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-provider-"));
    const requests: CodexResponsesRequest[] = [];
    const transport: CodexDirectTransport = {
      createResponse(request) {
        requests.push(request);

        return Promise.resolve({
          id: "resp_local_agent_provider",
          status: "completed",
          outputText: "Inspected through OpenRouter.",
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
        prompt: "Inspect this repo.",
        worker: "codex_direct",
        provider: "openrouter",
        model: "anthropic/claude-opus-4.6",
        mode: "read-only"
      });

      const result = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport
      });
      const database = openRunsteadDatabase(created.stateDb);

      try {
        const decision = database
          .prepare(
            "SELECT action_json FROM policy_decisions WHERE action_id LIKE 'act_model_inference_request_%'"
          )
          .get() as { action_json: string };

        expect(JSON.parse(decision.action_json)).toMatchObject({
          resource: {
            type: "model_provider",
            id: "openrouter"
          }
        });
      } finally {
        database.close();
      }

      expect(result.status).toBe("completed");
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        modelProvider: "openrouter",
        model: "anthropic/claude-opus-4.6"
      });
      expect(requests[0]?.model).toBe("anthropic/claude-opus-4.6");
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

  it("marks budget-exhausted codex_direct edits as completed with warnings when verifiers pass", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-local-agent-budget-pass-")
    );
    const verifierCommand = nodeCommand(
      "const fs = require('node:fs'); process.exit(fs.readFileSync('README.md', 'utf8').includes('Edited by Runstead') ? 0 : 1);"
    );

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentEditPolicyForTest(workspace, verifierCommand);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Update the README.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "edit",
        maxTurns: 1,
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
        transport: editReadmeTransport()
      });
      const storedTask = showTask({ cwd: workspace, id: created.task.id }).task;

      expect(result.status).toBe("completed_with_warnings");
      expect(localAgentRunExitCode(result)).toBe(0);
      expect(storedTask.status).toBe("completed");
      expect(storedTask.output).toMatchObject({
        execution: {
          implementation: "applied",
          verification: "passed",
          agentCompletion: "budget_exhausted"
        }
      });
      expect(result.workerResult).toMatchObject({
        worker: "codex_direct",
        status: "failed",
        budget: {
          reason: "turns",
          maxTurns: 1
        }
      });
      expect(result.verifierResults).toEqual([
        expect.objectContaining({
          verifier: "test",
          exitCode: 0,
          timedOut: false
        })
      ]);
      expect(result.summary).toContain("turn budget exhausted after 1 turns");
      expect(result.summary).toContain("Verifiers: All verifier commands passed");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("undoes a local agent task through its recorded checkpoint", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-undo-"));
    const checkpointId = "chk_agent_undo_test";

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Update the README.",
        worker: "codex_direct",
        model: "gpt-5.3-codex",
        mode: "edit"
      });
      const checkpointDir = join(workspace, ".runstead", "checkpoints");
      const checkpoint = {
        id: checkpointId,
        workspace,
        checkpointDir,
        metadataPath: join(checkpointDir, `${checkpointId}.json`),
        statusPath: join(checkpointDir, `${checkpointId}.status.txt`),
        patchPath: join(checkpointDir, `${checkpointId}.patch`),
        untrackedDir: join(checkpointDir, `${checkpointId}.untracked`),
        untrackedFiles: [],
        head: "abc123",
        createdAt: "2026-05-16T08:00:00.000Z"
      };

      await mkdir(checkpoint.untrackedDir, { recursive: true });
      await writeFile(
        checkpoint.metadataPath,
        `${JSON.stringify(checkpoint)}\n`,
        "utf8"
      );
      await writeFile(checkpoint.statusPath, "", "utf8");
      await writeFile(checkpoint.patchPath, "", "utf8");
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        database
          .prepare("UPDATE tasks SET status = ?, output_json = ? WHERE id = ?")
          .run(
            "completed",
            JSON.stringify({
              summary: "Updated README.",
              checkpointId
            }),
            created.task.id
          );
      } finally {
        database.close();
      }

      const result = await undoLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        runner: (args) => {
          switch (args[0]) {
            case "rev-parse":
              return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
            case "reset":
              return Promise.resolve({ stdout: "reset", stderr: "", exitCode: 0 });
            case "ls-files":
              return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
            default:
              return Promise.resolve({ stdout: "", stderr: "unexpected", exitCode: 1 });
          }
        },
        actor: "local-admin",
        now: new Date("2026-05-16T08:05:00.000Z")
      });

      expect(result.checkpointId).toBe(checkpointId);
      expect(result.restore).toMatchObject({
        restoredTrackedPatch: false,
        currentHead: "abc123"
      });
      expect(formatLocalAgentUndoReport(result)).toContain("Runstead agent undo");
      expect(formatLocalAgentUndoReport(result)).toContain(
        `Checkpoint: ${checkpointId}`
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("resumes approved edit-mode tool calls without consuming another task attempt", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-local-agent-resume-"));
    const verifierCommand = nodeCommand("process.exit(0)");

    try {
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentVerifierForTest(workspace, verifierCommand);
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
      const waiting = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: editReadmeTransport()
      });

      expect(waiting.status).toBe("waiting_approval");
      expect(waiting.approval?.id).toMatch(/^appr_/);
      expect(waiting.task.attempt).toBe(1);

      if (waiting.approval === undefined) {
        throw new Error("Expected local agent edit task to request approval");
      }

      await decideApproval({
        cwd: workspace,
        id: waiting.approval.id,
        decision: "approved",
        decidedBy: "local-admin"
      });
      const resumeTarget = resolveLocalAgentResumeTarget({
        cwd: workspace,
        targetId: waiting.approval.id
      });
      expect(resumeTarget.taskId).toBe(created.task.id);
      expect(resumeTarget.approvalId).toBe(waiting.approval.id);
      expect(resumeTarget.note).toContain("Resolved approval");

      const resumed = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: editReadmeTransport()
      });

      expect(resumed.status).toBe("completed");
      expect(resumed.task.attempt).toBe(1);
      expect(await readFile(join(workspace, "README.md"), "utf8")).toBe(
        "# Edited by Runstead\n"
      );
      expect(resumed.audit.toolCalls).toEqual(
        expect.arrayContaining([
          {
            name: "filesystem.write",
            status: "completed",
            count: 1
          }
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("applies approved pending patches on resume without model regeneration", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "runstead-local-agent-pending-patch-resume-")
    );
    const verifierCommand = nodeCommand("process.exit(0)");

    try {
      await mkdir(join(workspace, "docs"), { recursive: true });
      await writeFile(join(workspace, "docs", "notes.txt"), "before\n");
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await allowLocalAgentVerifierForTest(workspace, verifierCommand);
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Update docs/notes.txt.",
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
      const waiting = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: patchDocsTransport()
      });

      expect(waiting.status).toBe("waiting_approval");
      expect(waiting.approval?.id).toMatch(/^appr_/);

      if (waiting.approval === undefined) {
        throw new Error("Expected patch approval");
      }

      expect(showApproval({ cwd: workspace, id: waiting.approval.id }).task?.id).toBe(
        created.task.id
      );
      const modelCallsBefore = countTaskToolCalls(
        created.stateDb,
        created.task.id,
        "model.inference.request"
      );
      const pendingPatch = readApprovalAction(created.stateDb, waiting.approval.id);

      expect(pendingPatch.context.pendingPatch).toMatchObject({
        mode: "replacements",
        filesTouched: ["docs/notes.txt"],
        replacements: [
          {
            path: "docs/notes.txt",
            search: "before",
            replace: "after"
          }
        ]
      });

      await decideApproval({
        cwd: workspace,
        id: waiting.approval.id,
        decision: "approved",
        decidedBy: "local-admin"
      });

      const resumed = await runLocalAgentTask({
        cwd: workspace,
        taskId: created.task.id,
        transport: rejectingTransport()
      });

      expect(resumed.status).toBe("completed");
      expect(resumed.summary).toContain("Applied approved pending patch");
      expect(resumed.task.attempt).toBe(1);
      await expect(readFile(join(workspace, "docs", "notes.txt"), "utf8")).resolves.toBe(
        "after\n"
      );
      expect(
        countTaskToolCalls(
          created.stateDb,
          created.task.id,
          "model.inference.request"
        )
      ).toBe(modelCallsBefore);
      expect(resumed.audit.toolCalls).toEqual(
        expect.arrayContaining([
          {
            name: "filesystem.patch",
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

  await writeFile(
    policyPath,
    addVerifierPolicyRule(writeAllowed, verifierCommand),
    "utf8"
  );
}

async function allowLocalAgentVerifierForTest(
  workspace: string,
  verifierCommand: string
): Promise<void> {
  const policyPath = join(workspace, ".runstead", "policies", "repo-maintenance.yaml");
  const raw = await readFile(policyPath, "utf8");

  await writeFile(policyPath, addVerifierPolicyRule(raw, verifierCommand), "utf8");
}

function addVerifierPolicyRule(policyYaml: string, verifierCommand: string): string {
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

  return policyYaml.replace("rules:\n", `rules:\n\n${verifierRule}`);
}

function editReadmeTransport(): CodexDirectTransport {
  let requests = 0;

  return {
    createResponse() {
      requests += 1;

      if (requests === 1) {
        return Promise.resolve({
          id: "resp_local_agent_resume_1",
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
        id: "resp_local_agent_resume_2",
        status: "completed",
        outputText: "Updated README.",
        toolCalls: [],
        finishReason: "stop",
        outputItems: []
      });
    }
  };
}

function patchDocsTransport(): CodexDirectTransport {
  return {
    createResponse() {
      return Promise.resolve({
        id: "resp_local_agent_pending_patch_1",
        status: "completed",
        outputText: "",
        toolCalls: [
          {
            id: "call_patch_docs",
            name: "apply_patch",
            arguments: JSON.stringify({
              replacements: [
                {
                  path: "docs/notes.txt",
                  search: "before",
                  replace: "after"
                }
              ]
            })
          }
        ],
        finishReason: "tool_calls",
        outputItems: []
      });
    }
  };
}

function rejectingTransport(): CodexDirectTransport {
  return {
    createResponse() {
      throw new Error("model transport must not be used for approved pending patch resume");
    }
  };
}

function countTaskToolCalls(
  stateDb: string,
  taskId: string,
  actionType: string
): number {
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM tool_calls
        WHERE task_id = ? AND action_type = ?
      `
      )
      .get(taskId, actionType) as { count: number };

    return row.count;
  } finally {
    database.close();
  }
}

function readApprovalAction(stateDb: string, approvalId: string): {
  context: {
    pendingPatch?: unknown;
  };
} {
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT pd.action_json
        FROM approvals a
        JOIN policy_decisions pd ON pd.id = a.policy_decision_id
        WHERE a.id = ?
      `
      )
      .get(approvalId) as { action_json: string };

    return JSON.parse(row.action_json) as {
      context: {
        pendingPatch?: unknown;
      };
    };
  } finally {
    database.close();
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
