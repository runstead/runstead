import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDomainPackTemplate } from "./template.js";
import { validateDomainPackDir } from "./validator.js";

describe("createDomainPackTemplate", () => {
  it("creates a valid starter domain pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-template-"));

    try {
      const result = await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: join(workspace, "customer-ops"),
        name: "Customer Ops",
        description: "Govern customer operations work."
      });
      const validation = await validateDomainPackDir(result.root);

      expect(result.files.map((file) => file.slice(result.root.length + 1))).toEqual([
        "domain.yaml",
        "goal-templates/default-goal.yaml",
        "task-types/manual_review.yaml",
        "policies/default.yaml",
        "fixtures/manifest.yaml",
        "fixtures/manual-review-smoke/README.md",
        "evals/benchmark.yaml"
      ]);
      expect(validation.valid).toBe(true);
      expect(validation.domain?.id).toBe("customer-ops");
      expect(validation.domain?.capabilityPolicy?.reads).toEqual([
        "workspace_item"
      ]);
      expect(validation.domain?.capabilityPolicy?.approvalsRequired).toEqual([
        "external_write"
      ]);
      expect(validation.goalTemplates[0]?.domain).toBe("customer-ops");
      expect(validation.taskTypes[0]?.domain).toBe("customer-ops");
      expect(validation.fixtures.map((fixture) => fixture.id)).toEqual([
        "manual-review-smoke"
      ]);
      expect(validation.evals.map((evaluation) => evaluation.id)).toEqual([
        "manual-review-smoke"
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refuses unsafe ids and existing files unless forced", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-template-"));

    try {
      await expect(
        createDomainPackTemplate({
          id: "../bad",
          outputDir: join(workspace, "bad")
        })
      ).rejects.toThrow("Domain pack id");

      const outputDir = join(workspace, "starter");
      await createDomainPackTemplate({ id: "starter", outputDir });
      await expect(
        createDomainPackTemplate({ id: "starter", outputDir })
      ).rejects.toThrow("Refusing to overwrite");
      await expect(
        createDomainPackTemplate({ id: "starter", outputDir, force: true })
      ).resolves.toMatchObject({
        root: outputDir
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
