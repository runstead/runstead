import { describe, expect, it } from "vitest";

import {
  ApprovalRequestSchema,
  GoalSchema,
  PolicyDecisionRecordSchema
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
