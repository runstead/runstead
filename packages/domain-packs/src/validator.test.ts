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
      "run_local_verifiers"
    ]);
    expect(formatDomainPackValidationResult(result)).toContain("Status: valid");
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
});
