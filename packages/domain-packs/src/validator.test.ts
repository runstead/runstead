import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatDomainPackValidationResult,
  validateDomainPackDir
} from "./validator.js";

describe("validateDomainPackDir", () => {
  it("validates the built-in repo-maintenance pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/repo-maintenance", import.meta.url)
    );

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("repo-maintenance");
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "keep-ci-green"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "repo_inspect",
      "run_local_verifiers",
      "ci_repair"
    ]);
    expect(formatDomainPackValidationResult(result)).toContain("Status: valid");
  });

  it("validates the experimental research-monitor pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/research-monitor", import.meta.url)
    );

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("research-monitor");
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "weekly-research-digest"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "scan_sources",
      "summarize_findings"
    ]);
  });

  it("validates the experimental email-followup draft-only pack", async () => {
    const packRoot = fileURLToPath(new URL("../packs/email-followup", import.meta.url));

    const result = await validateDomainPackDir(packRoot);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.domain?.id).toBe("email-followup");
    expect(result.goalTemplates.map((template) => template.id)).toEqual([
      "draft-pending-followups"
    ]);
    expect(result.taskTypes.map((taskType) => taskType.id)).toEqual([
      "scan_threads",
      "draft_followup"
    ]);
    expect(result.goalTemplates[0]?.generated.acceptanceContracts).toContain(
      "send_not_performed"
    );
  });

  it("reports missing and mismatched pack references", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "goal-templates"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid test pack.",
          "goal_templates:",
          "  - missing-template",
          "  - wrong-template",
          "task_types:",
          "  - missing_task",
          "  - wrong_task",
          "default_policy: policies/missing.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "goal-templates", "wrong-template.yaml"),
        [
          "id: other-template",
          "domain: other-pack",
          "title: Wrong Template",
          "description: Wrong domain.",
          "generated:",
          "  recurring_tasks: []",
          "  acceptance_contracts: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "wrong_task.yaml"),
        [
          "id: other_task",
          "domain: other-pack",
          "description: Wrong task type.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "goal_template_missing",
          "goal_template_id_mismatch",
          "goal_template_domain_mismatch",
          "task_type_missing",
          "task_type_id_mismatch",
          "task_type_domain_mismatch",
          "default_policy_missing"
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects unstable domain pack ids and versions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: Custom_Pack",
          "version: latest",
          "name: Custom Pack",
          "description: Invalid versioning test pack.",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "domain_yaml_invalid"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects invalid default policy yaml", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid policy test pack.",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "rules:",
          "  - id: invalid_decision",
          "    decision: maybe"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_invalid"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects duplicate default policy rule ids", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Duplicate policy rule test pack.",
          "goal_templates: []",
          "task_types: []",
          "default_policy: policies/default.yaml",
          "default_verifiers: []",
          "required_tools: []",
          "supported_workers: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        [
          "id: policy_custom_pack_v1",
          "version: 1",
          "rules:",
          "  - id: repeated_rule",
          "    decision: allow",
          "  - id: repeated_rule",
          "    decision: deny"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "default_policy_rule_duplicate_id"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("reports unregistered task yaml and undeclared worker routing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid worker routing test pack.",
          "goal_templates: []",
          "task_types:",
          "  - registered_task",
          "default_policy: policies/default.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        "rules: []\n",
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "registered_task.yaml"),
        [
          "id: registered_task",
          "domain: custom-pack",
          "description: Registered task with bad worker.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: codex_cli"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "extra_task.yaml"),
        [
          "id: extra_task",
          "domain: custom-pack",
          "description: Unregistered task.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "task_type_worker_undeclared"
          }),
          expect.objectContaining({
            severity: "warning",
            code: "task_type_unregistered_yaml"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects goal templates that schedule undeclared task types", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-pack-"));

    try {
      await mkdir(join(workspace, "goal-templates"), { recursive: true });
      await mkdir(join(workspace, "policies"), { recursive: true });
      await mkdir(join(workspace, "task-types"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: custom-pack",
          "version: 0.1.0",
          "name: Custom Pack",
          "description: Invalid goal template recurring task test pack.",
          "goal_templates:",
          "  - keep-fresh",
          "task_types:",
          "  - known_task",
          "default_policy: policies/default.yaml",
          "default_verifiers:",
          "  - command",
          "required_tools:",
          "  - shell",
          "supported_workers:",
          "  - shell"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "policies", "default.yaml"),
        "rules: []\n",
        "utf8"
      );
      await writeFile(
        join(workspace, "goal-templates", "keep-fresh.yaml"),
        [
          "id: keep-fresh",
          "domain: custom-pack",
          "title: Keep Fresh",
          "description: Schedules an undeclared task.",
          "generated:",
          "  recurring_tasks:",
          "    - missing_task",
          "  acceptance_contracts: []"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(workspace, "task-types", "known_task.yaml"),
        [
          "id: known_task",
          "domain: custom-pack",
          "description: Known task.",
          "default_priority: medium",
          "max_attempts: 1",
          "verifiers:",
          "  required:",
          "    - command:test",
          "worker_routing:",
          "  preferred: shell"
        ].join("\n"),
        "utf8"
      );

      const result = await validateDomainPackDir(workspace);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            code: "goal_template_recurring_task_unknown"
          })
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
