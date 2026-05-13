import { fileURLToPath } from "node:url";

import type { DomainPack } from "./domain-pack.js";

export const repoMaintenancePack = {
  id: "repo-maintenance",
  version: "0.1.0",
  name: "Repository Maintenance",
  description:
    "Keep software repositories healthy with governed AI workers and verifier-first evidence.",
  goalTemplates: ["keep-ci-green"],
  taskTypes: ["repo_inspect", "run_local_verifiers", "ci_repair"],
  defaultPolicy: "policies/repo-maintenance.yaml",
  defaultVerifiers: ["command", "git_diff_scope"],
  requiredTools: ["filesystem", "shell", "git", "github"],
  supportedWorkers: ["shell", "claude_code", "codex_cli"]
} satisfies DomainPack;

export const repoMaintenanceDomainYaml = `id: repo-maintenance
version: 0.1.0
name: Repository Maintenance
description: Keep software repositories healthy with governed AI workers.

scope:
  resource_types:
    - repository
    - branch
    - pull_request
    - workflow_run

goal_templates:
  - keep-ci-green

task_types:
  - repo_inspect
  - run_local_verifiers
  - ci_repair

default_policy: policies/repo-maintenance.yaml

default_verifiers:
  - command
  - git_diff_scope

required_tools:
  - filesystem
  - shell
  - git
  - github

supported_workers:
  - shell
  - claude_code
  - codex_cli

security:
  untrusted_inputs:
    - ci_log
    - github_issue_body
    - github_comment
  protected_paths:
    - ".env"
    - ".env.*"
    - "**/secrets/**"
    - "infra/prod/**"
`;

export function getRepoMaintenancePackDir(): string {
  return fileURLToPath(new URL("../packs/repo-maintenance", import.meta.url));
}
