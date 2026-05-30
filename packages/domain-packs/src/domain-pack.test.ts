import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadDomainPackFromFile,
  parseDomainPack,
  repoMaintenancePack
} from "./index.js";

describe("repo-maintenance pack", () => {
  it("matches the DomainPack contract", () => {
    expect(parseDomainPack(repoMaintenancePack).id).toBe("repo-maintenance");
  });

  it("requires Runstead compatibility metadata", () => {
    expect(() =>
      parseDomainPack({
        id: "custom-pack",
        version: "0.1.0",
        name: "Custom Pack",
        description: "Custom governed work.",
        goalTemplates: [],
        taskTypes: [],
        defaultPolicy: "policies/default.yaml",
        defaultVerifiers: [],
        requiredTools: [],
        supportedWorkers: []
      })
    ).toThrow();
  });

  it("loads and validates the built-in domain.yaml", async () => {
    const domainPath = fileURLToPath(
      new URL("../packs/repo-maintenance/domain.yaml", import.meta.url)
    );

    const pack = await loadDomainPackFromFile(domainPath);

    expect(pack).toMatchObject({
      id: "repo-maintenance",
      compatibility: {
        runsteadMinVersion: "0.0.0"
      },
      goalTemplates: ["keep-ci-green"],
      taskTypes: ["repo_inspect", "run_local_verifiers", "ci_repair"],
      defaultPolicy: "policies/repo-maintenance.yaml"
    });
    expect(pack.security?.protectedPaths).toContain(".env");
    expect(pack.security?.protectedPaths).toContain("infra/prod/**");
    expect(pack.capabilityPolicy).toMatchObject({
      reads: ["filesystem.repo", "git.status", "git.diff", "github.workflow_run"],
      writes: ["filesystem.patch", "git.branch", "github.pull_request_comment"],
      approvalsRequired: [
        "dependency_install",
        "protected_path_write",
        "external_comment"
      ],
      denied: ["secret_read", "production_infra_write"]
    });
    expect(pack.evidenceContracts).toEqual([
      {
        workflow: "keep-ci-green",
        outputs: [
          "repo_readiness",
          "command_output",
          "verifier_report",
          "git_diff_scope",
          "ci_repair_summary"
        ],
        completionCriteria: [
          "verifiers_pass_or_blockers_recorded",
          "diff_scope_reviewed",
          "protected_paths_untouched",
          "audit_event_recorded"
        ]
      }
    ]);
  });
});
