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
import { loadPolicyProfileFromFile } from "./policy-loader.js";
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
            action_type: "filesystem.write",
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
        const policy = await loadPolicyProfileFromFile(
          join(initialized.root, "policies", "repo-maintenance.yaml")
        );
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy,
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
        const policy = await loadPolicyProfileFromFile(
          join(initialized.root, "policies", "repo-maintenance.yaml")
        );
        const result = await runCodexDirectWorker({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy,
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
          "git.diff"
        ]
      },
      decision: "allow",
      risk: "low"
    }
  ]
};

function scriptedTransport(
  responses: Array<Awaited<ReturnType<CodexDirectTransport["createResponse"]>>>
): CodexDirectTransport & { requests: CodexResponsesRequest[] } {
  const requests: CodexResponsesRequest[] = [];

  return {
    requests,
    async createResponse(request) {
      requests.push(request);
      const response = responses.shift();

      if (response === undefined) {
        throw new Error("No scripted Codex response left");
      }

      return response;
    }
  };
}
