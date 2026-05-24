import { describe, expect, it } from "vitest";

import {
  createExternalWriteApprovalPolicy,
  createProtectedPathDenyPolicy,
  evaluatePolicy,
  matchesPolicyPathPattern,
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

  it("normalizes protected path matcher variants without widening case boundaries", () => {
    const protectedCases = [
      {
        pattern: ".env",
        paths: [".env", "./.env", "src/../.env", "src//../.env"]
      },
      {
        pattern: "infra/prod/**",
        paths: [
          "infra/prod/app.yaml",
          "./infra/prod/app.yaml",
          "infra\\prod\\app.yaml",
          "infra/prod/../prod/app.yaml",
          "infra//prod//app.yaml"
        ]
      },
      {
        pattern: "**/secrets/**",
        paths: [
          "apps/api/secrets/token.txt",
          "./apps/api/secrets/token.txt",
          "apps\\api\\secrets\\token.txt",
          "apps/api/../api/secrets/token.txt"
        ]
      }
    ];

    for (const item of protectedCases) {
      for (const path of item.paths) {
        expect(matchesPolicyPathPattern(path, item.pattern)).toBe(true);
      }
    }

    for (const path of [
      ".ENV",
      "infra/production/app.yaml",
      "apps/api/secrets-public/token.txt",
      "../.env"
    ]) {
      expect(
        [".env", "infra/prod/**", "**/secrets/**"].some((pattern) =>
          matchesPolicyPathPattern(path, pattern)
        )
      ).toBe(false);
    }
  });

  it("denies traversal-normalized files touched under the configured cwd", () => {
    const policy = createProtectedPathDenyPolicy([".env", "infra/prod/**"]);
    const decision = evaluatePolicy({
      policy,
      action: {
        actionId: "act_traversal",
        actionType: "filesystem.patch",
        resource: {
          type: "file",
          path: "/workspace/repo/src/../.env"
        },
        context: {
          cwd: "/workspace/repo",
          filesTouched: ["infra/prod/../prod/terraform.tfvars"]
        }
      }
    });

    expect(decision).toMatchObject({
      decision: "deny",
      risk: "critical",
      ruleId: "deny_protected_paths",
      matchedPath: ".env"
    });
  });

  it("uses risk class as a policy input for scaffold-scoped patches", () => {
    const policy = {
      id: "policy_scaffold_patch_test",
      version: 1,
      defaultDecision: "require_approval" as const,
      rules: [
        {
          id: "allow_scaffold_app_patch",
          when: {
            actionType: "filesystem.patch",
            riskClass: "scaffold_app_patch",
            path: {
              matchesAny: ["index.html", "styles.css"]
            }
          },
          decision: "allow" as const,
          risk: "medium" as const
        }
      ]
    };
    const allowed = evaluatePolicy({
      policy,
      action: {
        actionId: "act_scaffold_patch",
        actionType: "filesystem.patch",
        context: {
          filesTouched: ["index.html"],
          riskClass: "scaffold_app_patch"
        }
      }
    });
    const unclassified = evaluatePolicy({
      policy,
      action: {
        actionId: "act_workspace_patch",
        actionType: "filesystem.patch",
        context: {
          filesTouched: ["index.html"],
          riskClass: "workspace_patch"
        }
      }
    });

    expect(allowed).toMatchObject({
      decision: "allow",
      ruleId: "allow_scaffold_app_patch",
      matchedRiskClass: "scaffold_app_patch"
    });
    expect(unclassified).toMatchObject({
      decision: "require_approval",
      reason: "No policy rule matched"
    });
  });
});
