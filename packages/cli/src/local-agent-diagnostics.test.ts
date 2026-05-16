import type { Task } from "@runstead/core";
import { describe, expect, it } from "vitest";

import {
  diagnoseLocalAgentRun,
  diagnoseLocalAgentTask,
  formatLocalAgentDiagnostics
} from "./local-agent-diagnostics.js";

describe("local agent diagnostics", () => {
  it("explains approval, budget, verifier, and failed-tool states", () => {
    const diagnostics = diagnoseLocalAgentRun({
      task: localAgentTask({ id: "task_1" }),
      status: "failed",
      summary: "Verifier failed",
      approval: {
        id: "appr_1",
        reason: "filesystem.write requires approval"
      },
      workerResult: {
        failedToolCalls: 1,
        warnings: ["Codex Direct worker tool budget exhausted after 8 tool calls."],
        budget: {
          reason: "tool_calls",
          maxTurns: 8,
          maxToolCalls: 8,
          toolCalls: 8,
          failedToolCalls: 1
        }
      },
      verifierResults: [
        {
          verifier: "test",
          exitCode: 1,
          timedOut: false,
          forceKilled: false,
          evidenceId: "ev_1"
        }
      ]
    });

    expect(diagnostics.map((diagnostic) => diagnostic.cause)).toEqual([
      "approval required (appr_1): filesystem.write requires approval",
      "tool budget exhausted after 8 tool calls",
      "verifier failed: test exit=1 evidence=ev_1",
      "completed with 1 recoverable failed tool call"
    ]);
    expect(formatLocalAgentDiagnostics(diagnostics)).toContain(
      "  Retry: runstead approval approve appr_1 && runstead agent resume task_1"
    );
  });

  it("classifies stored task output diagnostics", () => {
    const diagnostics = diagnoseLocalAgentTask(
      localAgentTask({
        status: "blocked",
        output: {
          summary: "Tool action denied by policy",
          failedToolCalls: 2,
          verifierStatus: "failed",
          verifiers: [
            {
              verifier: "lint",
              exitCode: 2,
              timedOut: false,
              evidenceId: "ev_lint"
            }
          ],
          budget: {
            reason: "failed_tool_calls",
            maxTurns: 12,
            maxFailedToolCalls: 2,
            toolCalls: 4,
            failedToolCalls: 2
          }
        }
      })
    );

    expect(diagnostics.map((diagnostic) => diagnostic.cause)).toEqual([
      "failed-tool budget exhausted after 2 failed tool calls",
      "verifier failed: lint exit=2 evidence=ev_lint",
      "Tool action denied by policy",
      "completed with 2 recoverable failed tool calls"
    ]);
  });

  it("classifies Codex credential and model failures", () => {
    expect(
      diagnoseLocalAgentTask(
        localAgentTask({
          output: {
            summary: "Codex Responses request failed with status 401 unauthorized"
          }
        })
      )[0]
    ).toMatchObject({
      retry: "runstead codex status, then runstead codex login if needed"
    });
    expect(
      diagnoseLocalAgentTask(
        localAgentTask({
          output: {
            summary: "Model gpt-example does not exist"
          }
        })
      )[0]
    ).toMatchObject({
      retry: "runstead codex models --refresh"
    });
  });
});

function localAgentTask(input: {
  id?: string;
  status?: Task["status"];
  output?: Task["output"];
}): Task {
  return {
    id: input.id ?? "task_1",
    goalId: "goal_1",
    domain: "repo-maintenance",
    type: "local_agent_task",
    status: input.status ?? "failed",
    priority: "medium",
    attempt: 1,
    maxAttempts: 1,
    input: {
      prompt: "Inspect",
      mode: "read-only",
      worker: "codex_direct"
    },
    output: input.output ?? {},
    verifiers: [],
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z"
  };
}
