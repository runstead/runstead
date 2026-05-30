import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSkillPackageYaml } from "./skill-package.js";
import { formatSkillValidationReport, validateSkillPackageDir } from "./validator.js";

const VALID_SKILL_YAML = `name: fix-pnpm-ci-failures
version: 0.1.0
status: candidate
domain: repo-maintenance
description: Diagnose and repair pnpm-related CI failures.

triggers:
  - ci_failure
  - log_contains: "pnpm"
  - file_exists: "pnpm-lock.yaml"

scope:
  repos:
    - acme/app

allowed_tools:
  - filesystem.read
  - filesystem.write_workspace
  - shell.exec:pnpm_test
  - git.diff

denied_tools:
  - secret.read
  - network.write_external

permissions:
  network: deny_by_default
  dependency_install: approval_required

verifiers:
  - command: pnpm test
  - command: pnpm lint

provenance:
  created_from_tasks:
    - task_001
  author: agent-curator
`;

describe("parseSkillPackageYaml", () => {
  it("parses the v0.3 skill.yaml contract", () => {
    const skill = parseSkillPackageYaml(
      // yaml.parse is covered by loadSkillPackageFromFile; this keeps schema mapping focused.
      {
        name: "fix-pnpm-ci-failures",
        version: "0.1.0",
        status: "candidate",
        domain: "repo-maintenance",
        description: "Diagnose pnpm failures.",
        triggers: ["ci_failure", { log_contains: "pnpm" }],
        readiness: {
          platforms: ["linux"],
          required_env: [{ name: "GITHUB_TOKEN", purpose: "GitHub API access" }],
          required_connectors: ["github"],
          required_tools: ["filesystem.read"],
          required_workers: ["codex_cli"],
          fallback_for_connectors: ["github"],
          fallback_for_tools: ["browser.navigate"]
        },
        allowed_tools: ["filesystem.read"],
        denied_tools: ["secret.read"],
        permissions: {
          network: "deny_by_default"
        },
        verifiers: [{ command: "pnpm test" }],
        provenance: {
          created_from_tasks: ["task_001"],
          author: "agent-curator"
        }
      }
    );

    expect(skill).toMatchObject({
      name: "fix-pnpm-ci-failures",
      allowedTools: ["filesystem.read"],
      readiness: {
        platforms: ["linux"],
        requiredEnv: [{ name: "GITHUB_TOKEN", purpose: "GitHub API access" }],
        requiredConnectors: ["github"],
        requiredTools: ["filesystem.read"],
        requiredWorkers: ["codex_cli"],
        fallbackForConnectors: ["github"],
        fallbackForTools: ["browser.navigate"]
      },
      provenance: {
        createdFromTasks: ["task_001"]
      }
    });
  });

  it("rejects unstable skill names and versions", () => {
    expect(() =>
      parseSkillPackageYaml({
        name: "Fix_Pnpm_CI",
        version: "latest",
        status: "candidate",
        domain: "repo-maintenance",
        description: "Diagnose pnpm failures.",
        triggers: ["ci_failure"],
        allowed_tools: ["filesystem.read"],
        denied_tools: ["secret.read"],
        permissions: {
          network: "deny_by_default"
        },
        verifiers: [{ command: "pnpm test" }],
        provenance: {
          created_from_tasks: ["task_001"],
          author: "agent-curator"
        }
      })
    ).toThrow();
  });
});

describe("validateSkillPackageDir", () => {
  it("accepts a complete candidate skill package", async () => {
    const root = await createSkillPackageFixture("valid");

    try {
      const result = await validateSkillPackageDir(root);

      expect(result.valid).toBe(true);
      expect(result.skill?.name).toBe("fix-pnpm-ci-failures");
      expect(formatSkillValidationReport(result)).toContain("Status: valid");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports missing required files and policy overlap", async () => {
    const root = await createSkillPackageFixture("invalid");

    try {
      await rm(join(root, "rollback.md"), { force: true });
      await writeFile(
        join(root, "skill.yaml"),
        VALID_SKILL_YAML.replace(
          "denied_tools:\n  - secret.read",
          "denied_tools:\n  - secret.read\n  - filesystem.read"
        ),
        "utf8"
      );
      await writeFile(
        join(root, "permissions.yaml"),
        "network: deny_by_default\n",
        "utf8"
      );
      await chmod(join(root, "tests", "run.sh"), 0o644);

      const result = await validateSkillPackageDir(root);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "missing_required_file",
            path: "rollback.md"
          }),
          expect.objectContaining({
            code: "tool_policy_overlap"
          }),
          expect.objectContaining({
            code: "permissions_file_mismatch"
          }),
          expect.objectContaining({
            code: "test_script_not_executable"
          })
        ])
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects required files that are symlinks", async () => {
    const root = await createSkillPackageFixture("symlink");
    const outsideSkillDoc = join(tmpdir(), `runstead-skill-outside-${process.pid}.md`);

    try {
      await writeFile(outsideSkillDoc, "# Outside skill doc\n", "utf8");
      await rm(join(root, "SKILL.md"), { force: true });
      await symlink(outsideSkillDoc, join(root, "SKILL.md"));

      const result = await validateSkillPackageDir(root);

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "required_file_symlink",
            path: "SKILL.md"
          })
        ])
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outsideSkillDoc, { force: true });
    }
  });
});

async function createSkillPackageFixture(name: string): Promise<string> {
  const root = join(tmpdir(), `runstead-skill-${name}-${process.pid}`);

  await rm(root, { force: true, recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "skill.yaml"), VALID_SKILL_YAML, "utf8");
  await writeFile(join(root, "SKILL.md"), "# Fix pnpm CI failures\n", "utf8");
  await writeFile(
    join(root, "permissions.yaml"),
    ["network: deny_by_default", "dependency_install: approval_required", ""].join(
      "\n"
    ),
    "utf8"
  );
  await writeFile(join(root, "tests", "run.sh"), "#!/usr/bin/env sh\n", "utf8");
  await chmod(join(root, "tests", "run.sh"), 0o755);
  await writeFile(join(root, "rollback.md"), "# Rollback\n", "utf8");

  return root;
}
