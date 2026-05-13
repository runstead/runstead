import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { PolicyProfile } from "./policy.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { preflightToolAction } from "./tool-proxy.js";

const policyPath = fileURLToPath(
  new URL(
    "../../domain-packs/packs/repo-maintenance/policies/repo-maintenance.yaml",
    import.meta.url
  )
);

describe("preflightToolAction", () => {
  let policy: PolicyProfile;

  beforeAll(async () => {
    policy = await loadPolicyProfileFromFile(policyPath);
  });

  it("allows verifier shell commands and adds contract side effects", () => {
    const result = preflightToolAction({
      policy,
      action: {
        actionId: "act_shell_verifier",
        actionType: "shell.exec",
        context: {
          command: "pnpm test"
        }
      }
    });

    expect(result).toMatchObject({
      status: "allowed",
      contract: {
        actionType: "shell.exec",
        tool: "shell"
      },
      policyResult: {
        decision: "allow",
        ruleId: "allow_verifier_commands"
      }
    });
    expect(result.action.context?.sideEffects).toEqual([
      "execute_process",
      "read_workspace"
    ]);
  });

  it("denies filesystem writes to protected paths", () => {
    const result = preflightToolAction({
      policy,
      action: {
        actionId: "act_env_write",
        actionType: "filesystem.write",
        resource: {
          type: "file",
          path: ".env"
        }
      }
    });

    expect(result).toMatchObject({
      status: "denied",
      policyResult: {
        decision: "deny",
        ruleId: "deny_secret_files"
      },
      riskScore: {
        risk: "critical"
      }
    });
  });

  it("allows read-only git actions", () => {
    const result = preflightToolAction({
      policy,
      action: {
        actionId: "act_git_diff",
        actionType: "git.diff"
      }
    });

    expect(result).toMatchObject({
      status: "allowed",
      policyResult: {
        decision: "allow",
        ruleId: "allow_read_workspace"
      }
    });
  });

  it("throws when no tool contract exists", () => {
    expect(() =>
      preflightToolAction({
        policy,
        action: {
          actionId: "act_unknown",
          actionType: "unknown.action"
        }
      })
    ).toThrow("Tool contract not found");
  });
});
