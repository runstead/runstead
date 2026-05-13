import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProtectedPathDenyPolicy, evaluatePolicy } from "./policy.js";

const protectedPathPolicy = createProtectedPathDenyPolicy([
  ".env",
  ".env.*",
  "**/secrets/**",
  "infra/prod/**"
]);

describe("evaluatePolicy protected path rules", () => {
  it("denies a protected resource path", () => {
    const result = evaluatePolicy({
      policy: protectedPathPolicy,
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
      actionId: "act_env_write",
      decision: "deny",
      risk: "critical",
      ruleId: "deny_protected_paths",
      matchedPath: ".env"
    });
  });

  it("denies protected paths reported in files touched", () => {
    const result = evaluatePolicy({
      policy: protectedPathPolicy,
      action: {
        actionId: "act_files_touched",
        actionType: "shell.exec",
        context: {
          filesTouched: ["src/index.ts", ".env.local"]
        }
      }
    });

    expect(result.decision).toBe("deny");
    expect(result.matchedPath).toBe(".env.local");
  });

  it("denies nested secrets directories", () => {
    const result = evaluatePolicy({
      policy: protectedPathPolicy,
      action: {
        actionId: "act_secret",
        actionType: "filesystem.write",
        resource: {
          type: "file",
          path: "apps/api/secrets/provider-token.txt"
        }
      }
    });

    expect(result.decision).toBe("deny");
    expect(result.matchedPath).toBe("apps/api/secrets/provider-token.txt");
  });

  it("matches absolute workspace paths relative to cwd", () => {
    const cwd = "/workspace/repo";
    const result = evaluatePolicy({
      policy: protectedPathPolicy,
      action: {
        actionId: "act_absolute_path",
        actionType: "filesystem.write",
        resource: {
          type: "file",
          path: join(cwd, "infra/prod/terraform.tfvars")
        },
        context: {
          cwd
        }
      }
    });

    expect(result.decision).toBe("deny");
  });

  it("allows non-protected workspace paths", () => {
    const result = evaluatePolicy({
      policy: protectedPathPolicy,
      action: {
        actionId: "act_src_write",
        actionType: "filesystem.write",
        resource: {
          type: "file",
          path: "src/index.ts"
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_src_write",
      decision: "allow",
      risk: "low"
    });
  });
});
