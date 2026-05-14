import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatPolicyTestReport, testPolicyAction } from "./policy-command.js";
import { parsePolicyProfileYaml } from "./policy-loader.js";

const policyPath = fileURLToPath(
  new URL(
    "../../domain-packs/packs/repo-maintenance/policies/repo-maintenance.yaml",
    import.meta.url
  )
);

describe("testPolicyAction", () => {
  it("evaluates a policy file against an action file", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-policy-test-"));
    const actionPath = join(workspace, "action.yaml");

    try {
      await writeFile(
        actionPath,
        `action_id: act_policy_test
action_type: github.pr.create
context:
  side_effects:
    - github_pr_create
`,
        "utf8"
      );

      const report = await testPolicyAction({ policyPath, actionPath });
      const formatted = formatPolicyTestReport(report);

      expect(report.result).toMatchObject({
        decision: "require_approval",
        risk: "high",
        ruleId: "require_approval_external_write"
      });
      expect(formatted).toContain("Policy: policy_repo_maintenance_v1");
      expect(formatted).toContain("Decision: require_approval");
      expect(formatted).toContain("Rule: require_approval_external_write");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects duplicate policy rule ids", () => {
    expect(() =>
      parsePolicyProfileYaml({
        id: "policy_duplicate_rules",
        version: 1,
        rules: [
          {
            id: "repeat",
            when: {
              action_type: "filesystem.read"
            },
            decision: "allow",
            risk: "low"
          },
          {
            id: "repeat",
            when: {
              action_type: "filesystem.write"
            },
            decision: "deny",
            risk: "critical"
          }
        ]
      })
    ).toThrow("Duplicate policy rule id: repeat");
  });
});
