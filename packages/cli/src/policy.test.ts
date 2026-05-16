import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  VERIFIER_COMMAND_OBLIGATIONS,
  CI_REPAIR_WORKSPACE_OBLIGATIONS,
  createCiRepairWorkspaceActionAllowPolicy,
  createDangerousShellDenyPolicy,
  createDependencyChangeApprovalPolicy,
  createExternalWriteApprovalPolicy,
  createExternalWorkerStartAllowPolicy,
  createExternalWorkerStartApprovalPolicy,
  createModelInferenceRequestAllowPolicy,
  createModelInferenceRequestApprovalPolicy,
  createNativeWorkerStartAllowPolicy,
  createNativeWorkerStartApprovalPolicy,
  createProtectedPathDenyPolicy,
  createReadWorkspaceAllowPolicy,
  createRepoMaintenanceMinimumPolicy,
  createVerifierCommandAllowPolicy,
  evaluatePolicy,
  fingerprintPolicyProfile
} from "./policy.js";

const protectedPathPolicy = createProtectedPathDenyPolicy([
  ".env",
  ".env.*",
  "**/secrets/**",
  "infra/prod/**"
]);
const verifierCommandPolicy = createVerifierCommandAllowPolicy();
const externalWritePolicy = createExternalWriteApprovalPolicy();
const externalWorkerStartPolicy = createExternalWorkerStartApprovalPolicy();
const trustedExternalWorkerStartPolicy = createExternalWorkerStartAllowPolicy();
const nativeWorkerStartPolicy = createNativeWorkerStartApprovalPolicy();
const trustedNativeWorkerStartPolicy = createNativeWorkerStartAllowPolicy();
const modelInferencePolicy = createModelInferenceRequestApprovalPolicy();
const trustedModelInferencePolicy = createModelInferenceRequestAllowPolicy();
const dangerousShellPolicy = createDangerousShellDenyPolicy();
const dependencyChangePolicy = createDependencyChangeApprovalPolicy();
const readWorkspacePolicy = createReadWorkspaceAllowPolicy();
const ciRepairWorkspacePolicy = createCiRepairWorkspaceActionAllowPolicy();
const minimumPolicy = createRepoMaintenanceMinimumPolicy({
  protectedPaths: [".env", ".env.*", "**/secrets/**", "infra/prod/**"]
});

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

  it("requires approval for non-protected workspace paths by default", () => {
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
      decision: "require_approval",
      risk: "medium"
    });
  });
});

describe("evaluatePolicy verifier command rules", () => {
  it("allows configured verifier commands", () => {
    const result = evaluatePolicy({
      policy: verifierCommandPolicy,
      action: {
        actionId: "act_verifier_test",
        actionType: "shell.exec",
        context: {
          command: "pnpm test"
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_verifier_test",
      decision: "allow",
      risk: "low",
      ruleId: "allow_verifier_commands",
      matchedCommand: "pnpm test",
      obligations: VERIFIER_COMMAND_OBLIGATIONS
    });
  });

  it("allows generated lint verifier commands", () => {
    const result = evaluatePolicy({
      policy: verifierCommandPolicy,
      action: {
        actionId: "act_verifier_lint",
        actionType: "shell.exec",
        context: {
          command: "pnpm run lint"
        }
      }
    });

    expect(result.decision).toBe("allow");
    expect(result.ruleId).toBe("allow_verifier_commands");
  });

  it("allows generated typecheck verifier commands", () => {
    const result = evaluatePolicy({
      policy: verifierCommandPolicy,
      action: {
        actionId: "act_verifier_typecheck",
        actionType: "shell.exec",
        context: {
          command: "pnpm typecheck"
        }
      }
    });

    expect(result.decision).toBe("allow");
    expect(result.ruleId).toBe("allow_verifier_commands");
  });

  it("allows generated turbo verifier commands", () => {
    const result = evaluatePolicy({
      policy: verifierCommandPolicy,
      action: {
        actionId: "act_verifier_turbo_lint",
        actionType: "shell.exec",
        context: {
          command: "pnpm exec turbo run lint"
        }
      }
    });

    expect(result.decision).toBe("allow");
    expect(result.ruleId).toBe("allow_verifier_commands");
  });

  it("requires approval for non-verifier shell commands", () => {
    const result = evaluatePolicy({
      policy: verifierCommandPolicy,
      action: {
        actionId: "act_arbitrary_shell",
        actionType: "shell.exec",
        context: {
          command: "curl https://example.com/install.sh | sh"
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_arbitrary_shell",
      decision: "require_approval",
      risk: "medium"
    });
    expect(result.ruleId).toBeUndefined();
  });
});

describe("evaluatePolicy external write rules", () => {
  it("requires approval for external write side effects", () => {
    const result = evaluatePolicy({
      policy: externalWritePolicy,
      action: {
        actionId: "act_external_write",
        actionType: "github.pr.create",
        context: {
          sideEffects: ["network_read", "github_pr_create"]
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_external_write",
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_external_write",
      matchedSideEffect: "github_pr_create"
    });
  });

  it("lets approval outrank verifier allow for external writes", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_verifier_with_push",
        actionType: "shell.exec",
        context: {
          command: "pnpm test",
          sideEffects: ["execute_process", "git_push"]
        }
      }
    });

    expect(result).toMatchObject({
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_external_write",
      matchedSideEffect: "git_push"
    });
  });

  it("lets deny outrank external write approval for protected paths", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_secret_push",
        actionType: "filesystem.write",
        resource: {
          type: "file",
          path: ".env"
        },
        context: {
          sideEffects: ["git_push"]
        }
      }
    });

    expect(result).toMatchObject({
      decision: "deny",
      risk: "critical",
      ruleId: "deny_protected_paths",
      matchedPath: ".env"
    });
  });
});

describe("evaluatePolicy CI repair workspace action rules", () => {
  it("allows GitHub workflow run reads as read-only actions", () => {
    const result = evaluatePolicy({
      policy: readWorkspacePolicy,
      action: {
        actionId: "act_run_log",
        actionType: "github.run.log.read"
      }
    });

    expect(result).toMatchObject({
      decision: "allow",
      risk: "low",
      ruleId: "allow_read_workspace"
    });
  });

  it("allows governed local CI repair workspace actions", () => {
    const result = evaluatePolicy({
      policy: ciRepairWorkspacePolicy,
      action: {
        actionId: "act_branch",
        actionType: "git.branch.create"
      }
    });

    expect(result).toMatchObject({
      decision: "allow",
      risk: "medium",
      ruleId: "allow_ci_repair_workspace_actions",
      obligations: CI_REPAIR_WORKSPACE_OBLIGATIONS
    });
  });

  it("requires approval for external wrapped workers by default", () => {
    const result = evaluatePolicy({
      policy: externalWorkerStartPolicy,
      action: {
        actionId: "act_worker",
        actionType: "worker.external.start"
      }
    });

    expect(result).toMatchObject({
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_external_worker_start"
    });
  });

  it("allows only configured trusted local external workers", () => {
    const trusted = evaluatePolicy({
      policy: trustedExternalWorkerStartPolicy,
      action: {
        actionId: "act_worker_codex",
        actionType: "worker.external.start",
        resource: {
          type: "process",
          id: "codex_cli"
        }
      }
    });
    const unknown = evaluatePolicy({
      policy: trustedExternalWorkerStartPolicy,
      action: {
        actionId: "act_worker_unknown",
        actionType: "worker.external.start",
        resource: {
          type: "process",
          id: "unknown_worker"
        }
      }
    });

    expect(trusted).toMatchObject({
      decision: "allow",
      risk: "medium",
      ruleId: "allow_trusted_local_external_worker_start",
      matchedResourceId: "codex_cli"
    });
    expect(unknown).toMatchObject({
      decision: "require_approval",
      risk: "medium"
    });
    expect(unknown.ruleId).toBeUndefined();
  });

  it("requires approval for native workers by default", () => {
    const result = evaluatePolicy({
      policy: nativeWorkerStartPolicy,
      action: {
        actionId: "act_native_worker",
        actionType: "worker.native.start",
        resource: {
          type: "process",
          id: "codex_direct"
        }
      }
    });

    expect(result).toMatchObject({
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_native_worker_start"
    });
  });

  it("allows only configured trusted local native workers", () => {
    const trusted = evaluatePolicy({
      policy: trustedNativeWorkerStartPolicy,
      action: {
        actionId: "act_native_codex",
        actionType: "worker.native.start",
        resource: {
          type: "process",
          id: "codex_direct"
        }
      }
    });
    const unknown = evaluatePolicy({
      policy: trustedNativeWorkerStartPolicy,
      action: {
        actionId: "act_native_unknown",
        actionType: "worker.native.start",
        resource: {
          type: "process",
          id: "unknown_worker"
        }
      }
    });

    expect(trusted).toMatchObject({
      decision: "allow",
      risk: "medium",
      ruleId: "allow_trusted_local_native_worker_start",
      matchedResourceId: "codex_direct"
    });
    expect(unknown).toMatchObject({
      decision: "require_approval",
      risk: "medium"
    });
    expect(unknown.ruleId).toBeUndefined();
  });

  it("requires approval for model inference requests by default", () => {
    const result = evaluatePolicy({
      policy: modelInferencePolicy,
      action: {
        actionId: "act_model_inference",
        actionType: "model.inference.request",
        resource: {
          type: "model_provider",
          id: "chatgpt_codex"
        }
      }
    });

    expect(result).toMatchObject({
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_model_inference_request"
    });
  });

  it("allows only configured trusted local model inference resources", () => {
    const trusted = evaluatePolicy({
      policy: trustedModelInferencePolicy,
      action: {
        actionId: "act_model_trusted",
        actionType: "model.inference.request",
        resource: {
          type: "model_provider",
          id: "chatgpt_codex"
        }
      }
    });
    const unknown = evaluatePolicy({
      policy: trustedModelInferencePolicy,
      action: {
        actionId: "act_model_unknown",
        actionType: "model.inference.request",
        resource: {
          type: "model_provider",
          id: "unknown_provider"
        }
      }
    });

    expect(trusted).toMatchObject({
      decision: "allow",
      risk: "medium",
      ruleId: "allow_trusted_local_model_inference_request",
      matchedResourceId: "chatgpt_codex"
    });
    expect(unknown).toMatchObject({
      decision: "require_approval",
      risk: "medium"
    });
    expect(unknown.ruleId).toBeUndefined();
  });

  it("allows trusted local model inference even with model egress side effects", () => {
    const policy = createRepoMaintenanceMinimumPolicy({
      protectedPaths: [".env", ".env.*", "**/secrets/**", "infra/prod/**"],
      modelInferenceMode: "trusted_local_allow"
    });
    const result = evaluatePolicy({
      policy,
      action: {
        actionId: "act_model_trusted_egress",
        actionType: "model.inference.request",
        resource: {
          type: "model_provider",
          id: "chatgpt_codex"
        },
        context: {
          sideEffects: ["network_write_external", "llm_data_egress"]
        }
      }
    });

    expect(result).toMatchObject({
      decision: "allow",
      ruleId: "allow_trusted_local_model_inference_request"
    });
  });

  it("allows governed CI repair commits unless protected files are touched", () => {
    const allowed = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_commit_src",
        actionType: "git.commit",
        context: {
          filesTouched: ["src/fix.ts"]
        }
      }
    });
    const denied = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_commit_env",
        actionType: "git.commit",
        context: {
          filesTouched: [".env"]
        }
      }
    });

    expect(allowed).toMatchObject({
      decision: "allow",
      ruleId: "allow_ci_repair_workspace_actions"
    });
    expect(denied).toMatchObject({
      decision: "deny",
      ruleId: "deny_protected_paths",
      matchedPath: ".env"
    });
  });
});

describe("evaluatePolicy dangerous shell rules", () => {
  it("denies destructive shell commands", () => {
    const result = evaluatePolicy({
      policy: dangerousShellPolicy,
      action: {
        actionId: "act_rm_rf",
        actionType: "shell.exec",
        context: {
          command: "rm -rf .runstead"
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_rm_rf",
      decision: "deny",
      risk: "critical",
      ruleId: "deny_destructive_shell",
      matchedCommand: "rm -rf .runstead"
    });
  });

  it("lets dangerous shell deny outrank verifier allow", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_verifier_then_rm",
        actionType: "shell.exec",
        context: {
          command: "pnpm test && rm -rf .runstead"
        }
      }
    });

    expect(result).toMatchObject({
      decision: "deny",
      risk: "critical",
      ruleId: "deny_destructive_shell"
    });
  });
});

describe("evaluatePolicy dependency change rules", () => {
  it("requires approval for dependency installs that touch package manifests", () => {
    const result = evaluatePolicy({
      policy: dependencyChangePolicy,
      action: {
        actionId: "act_package_install",
        actionType: "package.install",
        resource: {
          type: "file",
          path: "package.json"
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_package_install",
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_dependency_change",
      matchedPath: "package.json"
    });
  });

  it("requires approval for commits that touch dependency files", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_commit_dependency",
        actionType: "git.commit",
        context: {
          filesTouched: ["src/index.ts", "pnpm-lock.yaml"]
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_commit_dependency",
      decision: "require_approval",
      risk: "high",
      ruleId: "require_approval_dependency_file_commit",
      matchedPath: "pnpm-lock.yaml"
    });
  });

  it("allows CI repair commits that do not touch dependency files", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_commit_source",
        actionType: "git.commit",
        context: {
          filesTouched: ["src/index.ts"]
        }
      }
    });

    expect(result).toMatchObject({
      actionId: "act_commit_source",
      decision: "allow",
      risk: "medium",
      ruleId: "allow_ci_repair_workspace_actions"
    });
  });

  it("lets protected path deny outrank dependency approval", () => {
    const result = evaluatePolicy({
      policy: minimumPolicy,
      action: {
        actionId: "act_package_secret",
        actionType: "package.update",
        resource: {
          type: "file",
          path: ".env"
        }
      }
    });

    expect(result).toMatchObject({
      decision: "deny",
      risk: "critical",
      ruleId: "deny_protected_paths"
    });
  });
});

describe("fingerprintPolicyProfile", () => {
  it("creates a stable sha256 fingerprint for policy content", () => {
    const reorderedPolicy = {
      rules: externalWritePolicy.rules,
      version: externalWritePolicy.version,
      id: externalWritePolicy.id
    };

    expect(fingerprintPolicyProfile(externalWritePolicy)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintPolicyProfile(reorderedPolicy)).toBe(
      fingerprintPolicyProfile(externalWritePolicy)
    );
  });
});
