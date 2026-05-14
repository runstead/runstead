import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import type { RunCiRepairOrchestratorResult } from "./ci-repair-orchestrator.js";
import {
  handleGitHubWorkflowRunWebhook,
  recordGitHubWorkflowRunWebhookEvent
} from "./webhook-workflow-run.js";

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
    const audits: unknown[] = [];
    const ciRepair = fakeCiRepair("123");
    const result = await handleGitHubWorkflowRunWebhook({
      event: "workflow_run",
      payload: repairablePayload,
      cwd: "/repo",
      authToken: "token",
      verifierCommands: [{ name: "test", command: "pnpm test" }],
      intake: (options) => {
        calls.push(options);
        return Promise.resolve(ciRepair);
      },
      audit: (options) => {
        audits.push(options);
        return Promise.resolve(undefined);
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
        authToken: "token",
        verifierCommands: [{ name: "test", command: "pnpm test" }]
      }
    ]);
    expect(audits).toEqual([
      {
        cwd: "/repo",
        event: "workflow_run",
        result
      }
    ]);
  });

  it("runs governed orchestration when requested", async () => {
    const calls: unknown[] = [];
    const audits: unknown[] = [];
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
      },
      now: new Date("2026-05-14T08:00:00.000Z"),
      audit: (options) => {
        audits.push(options);
        return Promise.resolve(undefined);
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
    expect(audits).toEqual([
      {
        cwd: "/repo",
        event: "workflow_run",
        result,
        now: new Date("2026-05-14T08:00:00.000Z")
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

  it("records handled webhook events in the audit log", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-webhook-audit-"));
    const root = join(workspace, ".runstead");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(join(root, "state.db")).close();

      const event = await recordGitHubWorkflowRunWebhookEvent({
        cwd: workspace,
        event: "workflow_run",
        result: {
          handled: true,
          mode: "orchestrate",
          runId: "123",
          orchestration: fakeOrchestration("123")
        },
        now: new Date("2026-05-14T08:15:00.000Z")
      });
      const eventId = event?.eventId;

      if (eventId === undefined) {
        throw new Error("Expected webhook audit event");
      }

      const database = openRunsteadDatabase(join(root, "state.db"));

      try {
        const row = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE event_id = ?
          `
          )
          .get(eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

        expect(row).toMatchObject({
          type: "webhook.workflow_run_handled",
          aggregate_type: "github_workflow_run",
          aggregate_id: "123",
          created_at: "2026-05-14T08:15:00.000Z"
        });
        expect(JSON.parse(row.payload_json)).toEqual({
          sourceEvent: "workflow_run",
          mode: "orchestrate",
          runId: "123",
          taskId: "task_ci",
          status: "waiting_approval",
          approvalId: "appr_ci"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records ignored webhook deliveries in the audit log", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-webhook-audit-"));
    const root = join(workspace, ".runstead");

    try {
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "config.yaml"),
        "version: 1\ndomain: repo-maintenance\n",
        "utf8"
      );
      openRunsteadDatabase(join(root, "state.db")).close();

      const event = await recordGitHubWorkflowRunWebhookEvent({
        cwd: workspace,
        event: "issues",
        result: {
          handled: false,
          reason: "not_repairable_workflow_run"
        },
        now: new Date("2026-05-14T08:20:00.000Z")
      });
      const database = openRunsteadDatabase(join(root, "state.db"));

      try {
        const row = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE event_id = ?
          `
          )
          .get(event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

        expect(row).toMatchObject({
          type: "webhook.workflow_run_ignored",
          aggregate_type: "github_webhook",
          aggregate_id: "issues",
          created_at: "2026-05-14T08:20:00.000Z"
        });
        expect(JSON.parse(row.payload_json)).toEqual({
          sourceEvent: "issues",
          handled: false,
          reason: "not_repairable_workflow_run"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
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
