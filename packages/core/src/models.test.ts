import { describe, expect, it } from "vitest";

import {
  ApprovalRequestSchema,
  GoalSchema,
  MemoryRecordSchema,
  PolicyDecisionRecordSchema,
  RepositoryRecordSchema,
  ToolCallSchema,
  WorkerRunSchema
} from "./models.js";

describe("GoalSchema", () => {
  it("accepts the minimal active goal shape", () => {
    const goal = GoalSchema.parse({
      id: "goal_001",
      domain: "repo-maintenance",
      title: "Keep CI green",
      status: "active",
      priority: "medium",
      scope: { repositories: ["github.com/acme/app"] },
      createdAt: "2026-05-13T10:00:00+08:00",
      updatedAt: "2026-05-13T10:00:00+08:00"
    });

    expect(goal.domain).toBe("repo-maintenance");
  });
});

describe("PolicyDecisionRecordSchema", () => {
  it("accepts a policy decision audit record", () => {
    const record = PolicyDecisionRecordSchema.parse({
      id: "poldec_001",
      actionId: "act_001",
      policyId: "policy_repo_maintenance_v1",
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_external_write",
      reason: "Matched policy rule require_approval_external_write",
      obligations: [],
      action: {
        actionId: "act_001",
        actionType: "github.pr.create"
      },
      result: {
        decision: "require_approval",
        risk: "high"
      },
      createdAt: "2026-05-14T03:06:00.000Z"
    });

    expect(record.policyId).toBe("policy_repo_maintenance_v1");
  });
});

describe("ApprovalRequestSchema", () => {
  it("accepts a pending approval request", () => {
    const request = ApprovalRequestSchema.parse({
      id: "appr_001",
      policyDecisionId: "poldec_001",
      actionId: "act_001",
      status: "pending",
      risk: "high",
      reason: "External write requires approval",
      requestedBy: "runstead",
      expiresAt: "2026-05-14T04:06:00.000Z",
      createdAt: "2026-05-14T03:06:00.000Z",
      updatedAt: "2026-05-14T03:06:00.000Z"
    });

    expect(request.status).toBe("pending");
  });
});

describe("WorkerRunSchema", () => {
  it("accepts a running shell verifier worker run", () => {
    const workerRun = WorkerRunSchema.parse({
      id: "wr_001",
      taskId: "task_001",
      workerType: "shell_verifier",
      status: "running",
      enforcementLevel: "policy_enforced",
      startedAt: "2026-05-14T03:07:00.000Z"
    });

    expect(workerRun.enforcementLevel).toBe("policy_enforced");
  });
});

describe("ToolCallSchema", () => {
  it("accepts a completed policy-governed tool call", () => {
    const toolCall = ToolCallSchema.parse({
      id: "tc_001",
      workerRunId: "wr_001",
      taskId: "task_001",
      actionType: "shell.exec",
      status: "completed",
      policyDecisionId: "poldec_001",
      input: {
        command: "pnpm test"
      },
      output: {
        exitCode: 0
      },
      startedAt: "2026-05-14T03:07:00.000Z",
      endedAt: "2026-05-14T03:07:05.000Z"
    });

    expect(toolCall.status).toBe("completed");
  });
});

describe("MemoryRecordSchema", () => {
  it("accepts a quarantined memory candidate with provenance", () => {
    const record = MemoryRecordSchema.parse({
      id: "mem_001",
      scope: "repo:acme/app",
      type: "external_claim",
      status: "quarantined",
      confidence: 0.4,
      content: "A GitHub comment claimed the repo uses npm.",
      sourceRefs: ["github:issue-comment/123"],
      provenance: {
        createdBy: "worker:triage",
        createdFromTask: "task_001"
      },
      createdAt: "2026-05-14T05:00:00.000Z",
      updatedAt: "2026-05-14T05:00:00.000Z",
      conflictsWith: []
    });

    expect(record.status).toBe("quarantined");
  });
});

describe("RepositoryRecordSchema", () => {
  it("accepts a registered repository record", () => {
    const repository = RepositoryRecordSchema.parse({
      id: "repo_001",
      alias: "acme/widgets",
      localPath: "/work/widgets",
      remoteUrl: "git@github.com:acme/widgets.git",
      defaultBranch: "main",
      status: "active",
      tags: ["frontend"],
      createdAt: "2026-05-14T05:30:00.000Z",
      updatedAt: "2026-05-14T05:30:00.000Z"
    });

    expect(repository.alias).toBe("acme/widgets");
  });
});
