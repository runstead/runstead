import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDomainPackTemplate,
  validateDomainPackDir
} from "@runstead/domain-packs";
import { describe, expect, it } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { initRunstead } from "./init.js";

describe("installDomainPack", () => {
  it("installs a validated pack into the local Runstead domain registry", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-install-"));
    const packRoot = join(workspace, "packs", "customer-ops");

    try {
      await initRunstead({ cwd: workspace });
      await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: packRoot
      });

      const result = await installDomainPack({
        cwd: workspace,
        ref: packRoot
      });
      const installedRoot = join(workspace, ".runstead", "domains", "customer-ops");
      const manifest = JSON.parse(
        await readFile(join(installedRoot, "runstead-manifest.json"), "utf8")
      ) as { domain: { id: string }; files: { path: string }[] };
      const validation = await validateDomainPackDir(installedRoot);

      expect(result).toMatchObject({
        id: "customer-ops",
        destination: installedRoot,
        overwritten: false
      });
      expect(result.installedFiles).toEqual(
        expect.arrayContaining([
          "domain.yaml",
          "goal-templates/default-goal.yaml",
          "task-types/manual_review.yaml",
          "fixtures/manifest.yaml",
          "fixtures/manual-review-smoke/README.md",
          "evals/benchmark.yaml"
        ])
      );
      expect(manifest.domain.id).toBe("customer-ops");
      expect(manifest.files.map((file) => file.path)).toEqual(result.installedFiles);
      expect(validation.valid).toBe(true);
      await expect(access(join(installedRoot, "domain.yaml"))).resolves.toBeUndefined();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires force before overwriting an installed pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-install-"));
    const packRoot = join(workspace, "packs", "customer-ops");

    try {
      await initRunstead({ cwd: workspace });
      await createDomainPackTemplate({
        id: "customer-ops",
        outputDir: packRoot
      });
      await installDomainPack({
        cwd: workspace,
        ref: packRoot
      });

      await expect(
        installDomainPack({
          cwd: workspace,
          ref: packRoot
        })
      ).rejects.toThrow("already installed");
      await expect(
        installDomainPack({
          cwd: workspace,
          ref: packRoot,
          force: true
        })
      ).resolves.toMatchObject({
        id: "customer-ops",
        overwritten: true
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
