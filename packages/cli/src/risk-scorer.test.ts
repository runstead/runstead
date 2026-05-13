import { describe, expect, it } from "vitest";

import { createExternalWriteApprovalPolicy, evaluatePolicy } from "./policy.js";
import { scoreActionRisk } from "./risk-scorer.js";

describe("scoreActionRisk", () => {
  it("scores read-only actions as low risk", () => {
    const score = scoreActionRisk({
      action: {
        actionId: "act_read",
        actionType: "git.diff",
        context: {
          sideEffects: ["read_workspace"]
        }
      }
    });

    expect(score).toEqual({
      risk: "low",
      reasons: ["action type git.diff", "side effect read_workspace"]
    });
  });

  it("promotes external writes to high risk", () => {
    const action = {
      actionId: "act_external_write",
      actionType: "github.pr.create",
      context: {
        sideEffects: ["read_workspace", "github_pr_create"]
      }
    };
    const policy = createExternalWriteApprovalPolicy();
    const policyResult = evaluatePolicy({ policy, action });
    const score = scoreActionRisk({ action, policyResult });

    expect(score).toEqual({
      risk: "high",
      reasons: [
        "policy rule require_approval_external_write",
        "action type github.pr.create",
        "side effect github_pr_create"
      ]
    });
  });

  it("promotes secret access to critical risk", () => {
    const score = scoreActionRisk({
      action: {
        actionId: "act_secret_access",
        actionType: "filesystem.read",
        context: {
          sideEffects: ["secret_access"]
        }
      }
    });

    expect(score).toEqual({
      risk: "critical",
      reasons: ["side effect secret_access"]
    });
  });
});
