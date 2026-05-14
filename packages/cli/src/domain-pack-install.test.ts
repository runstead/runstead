import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDomainPackTemplate,
  validateDomainPackDir
} from "@runstead/domain-packs";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { installDomainPack, uninstallDomainPack } from "./domain-pack-install.js";
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

  it("uninstalls a local domain pack and records an audit event", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-uninstall-"));
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

      const result = await uninstallDomainPack({
        cwd: workspace,
        id: "customer-ops",
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const installedRoot = join(workspace, ".runstead", "domains", "customer-ops");
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE type = 'domain_pack.uninstalled'
          `
          )
          .get() as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

        expect(result).toMatchObject({
          id: "customer-ops",
          destination: installedRoot,
          activeGoals: 0,
          activeTasks: 0,
          removed: true
        });
        expect(result.manifest?.domain.id).toBe("customer-ops");
        await expect(access(installedRoot)).rejects.toMatchObject({ code: "ENOENT" });
        expect(event).toMatchObject({
          type: "domain_pack.uninstalled",
          aggregate_type: "domain_pack",
          aggregate_id: "customer-ops",
          created_at: "2026-05-14T12:00:00.000Z"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          id: "customer-ops",
          version: "0.1.0",
          activeGoals: 0,
          activeTasks: 0,
          forced: false
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires force before uninstalling a domain pack with active work", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-uninstall-"));
    const installedRoot = join(workspace, ".runstead", "domains", "repo-maintenance");

    try {
      await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      await expect(
        uninstallDomainPack({
          cwd: workspace,
          id: "repo-maintenance"
        })
      ).rejects.toThrow("still in use");
      await expect(access(installedRoot)).resolves.toBeUndefined();

      await expect(
        uninstallDomainPack({
          cwd: workspace,
          id: "repo-maintenance",
          force: true
        })
      ).resolves.toMatchObject({
        id: "repo-maintenance",
        activeGoals: 1,
        activeTasks: 1,
        removed: true
      });
      await expect(access(installedRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
