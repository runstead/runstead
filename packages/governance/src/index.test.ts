import { describe, expect, it } from "vitest";

import {
  createExternalWriteApprovalPolicy,
  evaluatePolicy,
  scoreActionRisk
} from "./index.js";

describe("@runstead/governance", () => {
  it("evaluates policies and scores action risk outside the CLI package", () => {
    const policy = createExternalWriteApprovalPolicy();
    const action = {
      actionId: "act_governance_package",
      actionType: "github.pr.create",
      context: {
        sideEffects: ["github_pr_create"]
      }
    };
    const decision = evaluatePolicy({ policy, action });
    const risk = scoreActionRisk({ action, policyResult: decision });

    expect(decision).toMatchObject({
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_external_write"
    });
    expect(risk.risk).toBe("high");
    expect(risk.reasons).toEqual(
      expect.arrayContaining([
        "policy rule require_approval_external_write",
        "action type github.pr.create",
        "side effect github_pr_create"
      ])
    );
  });
});
