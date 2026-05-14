import { describe, expect, it } from "vitest";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import type { RunCiRepairOrchestratorResult } from "./ci-repair-orchestrator.js";
import { handleGitHubWorkflowRunWebhook } from "./webhook-workflow-run.js";

const repairablePayload = {
  action: "completed",
  workflow_run: {
    id: 123,
    status: "completed",
    conclusion: "failure"
  }
};

describe("handleGitHubWorkflowRunWebhook", () => {
  it("ignores non-repairable webhook events", async () => {
    const result = await handleGitHubWorkflowRunWebhook({
      event: "issues",
      payload: {},
      intake: () => Promise.reject(new Error("intake should not run"))
    });

    expect(result).toEqual({
      handled: false,
      reason: "not_repairable_workflow_run"
    });
  });

  it("creates intake tasks by default", async () => {
    const calls: unknown[] = [];
    const ciRepair = fakeCiRepair("123");
    const result = await handleGitHubWorkflowRunWebhook({
      event: "workflow_run",
      payload: repairablePayload,
      cwd: "/repo",
      authToken: "token",
      intake: (options) => {
        calls.push(options);
        return Promise.resolve(ciRepair);
      }
    });

    expect(result).toMatchObject({
      handled: true,
      mode: "intake",
      runId: "123",
      ciRepair
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        runId: "123",
        authToken: "token"
      }
    ]);
  });

  it("runs governed orchestration when requested", async () => {
    const calls: unknown[] = [];
    const orchestration = fakeOrchestration("123");
    const result = await handleGitHubWorkflowRunWebhook({
      event: "workflow_run",
      payload: repairablePayload,
      cwd: "/repo",
      authToken: "token",
      mode: "orchestrate",
      worker: "claude_code",
      base: "main",
      draft: true,
      allowedPaths: ["src/**"],
      deniedPaths: [".env"],
      verifierCommands: [{ name: "test", command: "pnpm test" }],
      orchestrate: (options) => {
        calls.push(options);
        return Promise.resolve(orchestration);
      }
    });

    expect(result).toMatchObject({
      handled: true,
      mode: "orchestrate",
      runId: "123",
      orchestration
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        runId: "123",
        worker: "claude_code",
        base: "main",
        draft: true,
        allowedPaths: ["src/**"],
        deniedPaths: [".env"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        authToken: "token"
      }
    ]);
  });

  it("requires verifiers for orchestrated repairs", async () => {
    await expect(
      handleGitHubWorkflowRunWebhook({
        event: "workflow_run",
        payload: repairablePayload,
        mode: "orchestrate"
      })
    ).rejects.toThrow("--verifier is required");
  });
});

function fakeCiRepair(runId: string): CreateCiRepairTaskResult {
  return {
    cwd: "/repo",
    stateDb: "/repo/.runstead/state.db",
    task: {
      id: "task_ci",
      goalId: "goal_ci",
      domain: "repo-maintenance",
      type: "ci_repair",
      status: "queued",
      priority: "high",
      attempt: 0,
      maxAttempts: 1,
      input: { runId },
      verifiers: ["evidence:github_workflow_run"],
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z"
    },
    event: {
      eventId: "evt_ci",
      type: "task.created",
      aggregateType: "task",
      aggregateId: "task_ci",
      payload: { runId },
      createdAt: "2026-05-14T00:00:00.000Z"
    },
    evidence: {
      id: "ev_ci",
      type: "github_workflow_run",
      subjectType: "task",
      subjectId: "task_ci",
      uri: "file:///repo/.runstead/evidence/ci.json",
      createdAt: "2026-05-14T00:00:00.000Z"
    },
    evidencePath: "/repo/.runstead/evidence/ci.json",
    workflowRun: {
      runId,
      status: "completed",
      conclusion: "failure"
    },
    log: {
      runId,
      log: "",
      byteLength: 0
    },
    created: true
  };
}

function fakeOrchestration(runId: string): RunCiRepairOrchestratorResult {
  const ciRepair = fakeCiRepair(runId);

  return {
    status: "waiting_approval",
    ciRepair,
    branchName: "runstead/task_ci",
    approval: {
      id: "appr_ci",
      actionId: "act_pr",
      policyDecisionId: "pol_pr",
      reason: "external write"
    }
  };
}
