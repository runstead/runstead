import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildDomainPackManifest } from "./manifest.js";
import { createDomainPackTemplate } from "./template.js";

describe("buildDomainPackManifest", () => {
  it("builds a deterministic manifest for the built-in repo-maintenance pack", async () => {
    const packRoot = fileURLToPath(
      new URL("../packs/repo-maintenance", import.meta.url)
    );

    const manifest = await buildDomainPackManifest(packRoot);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      domain: {
        id: "repo-maintenance",
        version: "0.1.0",
        name: "Repository Maintenance"
      },
      compatibility: {
        runsteadMinVersion: "0.0.0"
      },
      defaultPolicy: "policies/repo-maintenance.yaml",
      goalTemplates: ["keep-ci-green"],
      taskTypes: ["repo_inspect", "run_local_verifiers", "ci_repair"],
      fixtures: ["js-test-failure"],
      evals: ["js-test-failure-smoke"],
      requiredTools: ["filesystem", "shell", "git", "github"],
      supportedWorkers: ["shell", "claude_code", "codex_cli"]
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      "domain.yaml",
      "evals/benchmark.yaml",
      "fixtures/js-test-failure/README.md",
      "fixtures/manifest.yaml",
      "goal-templates/keep-ci-green.yaml",
      "policies/repo-maintenance.yaml",
      "task-types/ci_repair.yaml",
      "task-types/repo_inspect.yaml",
      "task-types/run_local_verifiers.yaml"
    ]);
    expect(manifest.files.every((file) => file.bytes > 0)).toBe(true);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(
      true
    );
  });

  it("includes fixture and eval files in generated pack manifests", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-manifest-"));

    try {
      const template = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops")
      });

      const manifest = await buildDomainPackManifest(template.root);

      expect(manifest.fixtures).toEqual(["manual-review-smoke"]);
      expect(manifest.evals).toEqual(["manual-review-smoke"]);
      expect(manifest.files.map((file) => file.path)).toEqual([
        "domain.yaml",
        "evals/benchmark.yaml",
        "fixtures/manifest.yaml",
        "fixtures/manual-review-smoke/README.md",
        "goal-templates/default-goal.yaml",
        "policies/default.yaml",
        "task-types/manual_review.yaml"
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects invalid packs instead of producing partial manifests", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-manifest-"));

    try {
      await mkdir(join(workspace, "policies"), { recursive: true });
      await writeFile(
        join(workspace, "domain.yaml"),
        [
          "id: invalid-pack",
          "version: 0.1.0",
          "name: Invalid Pack",
          "description: Missing task yaml.",
          "compatibility:",
          "  runstead_min_version: 0.0.0",
          "goal_templates: []",
          "task_types:",
          "  - missing_task",
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
      await writeFile(join(workspace, "policies", "default.yaml"), "rules: []\n");

      await expect(buildDomainPackManifest(workspace)).rejects.toThrow(
        "Cannot build manifest for invalid domain pack"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
