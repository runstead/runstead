import { join } from "node:path";

import { getAiNativeStartupPackDir } from "@runstead/domain-packs";
import { describe, expect, it } from "vitest";

import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";

describe("startup MVP policy", () => {
  it("allows narrow local product patches while protecting dependencies and external writes", async () => {
    const policy = await loadPolicyProfileFromFile(
      join(getAiNativeStartupPackDir(), "policies", "startup-mvp.yaml")
    );
    const productPatch = evaluatePolicy({
      policy,
      action: {
        actionId: "act_startup_product_patch",
        actionType: "filesystem.patch",
        context: {
          filesTouched: ["src/app.ts", "tests/app.test.ts", "README.md"]
        }
      }
    });
    const dependencyPatch = evaluatePolicy({
      policy,
      action: {
        actionId: "act_startup_dependency_patch",
        actionType: "filesystem.patch",
        context: {
          filesTouched: ["src/app.ts", "package.json"]
        }
      }
    });
    const push = evaluatePolicy({
      policy,
      action: {
        actionId: "act_startup_push",
        actionType: "git.push",
        context: {
          sideEffects: ["git_push"]
        }
      }
    });

    expect(productPatch).toMatchObject({
      decision: "allow",
      ruleId: "allow_local_mvp_product_patch"
    });
    expect(dependencyPatch).toMatchObject({
      decision: "require_approval",
      ruleId: "require_approval_for_dependency_patch"
    });
    expect(push).toMatchObject({
      decision: "require_approval",
      ruleId: "require_approval_for_external_write"
    });
  });
});
