import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDomainPackTemplate,
  validateDomainPackDir
} from "@runstead/domain-packs";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import {
  installDomainPack,
  uninstallDomainPack,
  upgradeDomainPack
} from "./domain-pack-install.js";
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
        ref: packRoot,
        now: new Date("2026-05-14T11:00:00.000Z")
      });
      const installedRoot = join(workspace, ".runstead", "domains", "customer-ops");
      const manifest = JSON.parse(
        await readFile(join(installedRoot, "runstead-manifest.json"), "utf8")
      ) as { domain: { id: string }; files: { path: string }[] };
      const validation = await validateDomainPackDir(installedRoot);
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE event_id = ?
          `
          )
          .get(result.event.eventId) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

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
        expect(event).toMatchObject({
          type: "domain_pack.installed",
          aggregate_type: "domain_pack",
          aggregate_id: "customer-ops",
          created_at: "2026-05-14T11:00:00.000Z"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          id: "customer-ops",
          version: "0.1.0",
          files: result.installedFiles.length,
          overwritten: false
        });
        await expect(
          access(join(installedRoot, "domain.yaml"))
        ).resolves.toBeUndefined();
      } finally {
        database.close();
      }
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

  it("rejects packs outside the current Runstead compatibility range", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-install-"));
    const packRoot = join(workspace, "packs", "future-ops");

    try {
      await initRunstead({ cwd: workspace });
      await createDomainPackTemplate({
        id: "future-ops",
        outputDir: packRoot
      });

      const domainYaml = await readFile(join(packRoot, "domain.yaml"), "utf8");
      await writeFile(
        join(packRoot, "domain.yaml"),
        domainYaml.replace(
          "runstead_min_version: 0.0.0",
          "runstead_min_version: 9.0.0"
        ),
        "utf8"
      );

      await expect(
        installDomainPack({
          cwd: workspace,
          ref: packRoot
        })
      ).rejects.toThrow("not compatible");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("upgrades an installed pack and records version drift", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-upgrade-"));
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

      const domainYaml = await readFile(join(packRoot, "domain.yaml"), "utf8");
      await writeFile(
        join(packRoot, "domain.yaml"),
        `${domainYaml.replace("version: 0.1.0", "version: 0.2.0")}\n${[
          "migrations:",
          "  - from_version: 0.1.0",
          "    to_version: 0.2.0",
          "    description: Add customer ops launch contracts.",
          "    steps:",
          "      - Rebuild generated tasks from the upgraded pack.",
          "      - Re-run pack evals before resuming active goals."
        ].join("\n")}\n`,
        "utf8"
      );

      const result = await upgradeDomainPack({
        cwd: workspace,
        ref: packRoot,
        now: new Date("2026-05-14T13:00:00.000Z")
      });
      const installedRoot = join(workspace, ".runstead", "domains", "customer-ops");
      const installedManifest = JSON.parse(
        await readFile(join(installedRoot, "runstead-manifest.json"), "utf8")
      ) as { domain: { version: string } };
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE type = 'domain_pack.upgraded'
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
          forced: false
        });
        expect(result.previousManifest?.domain.version).toBe("0.1.0");
        expect(result.manifest.domain.version).toBe("0.2.0");
        expect(result.migrationSteps).toEqual([
          "Rebuild generated tasks from the upgraded pack.",
          "Re-run pack evals before resuming active goals."
        ]);
        expect(installedManifest.domain.version).toBe("0.2.0");
        expect(event).toMatchObject({
          type: "domain_pack.upgraded",
          aggregate_type: "domain_pack",
          aggregate_id: "customer-ops",
          created_at: "2026-05-14T13:00:00.000Z"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          id: "customer-ops",
          previousVersion: "0.1.0",
          nextVersion: "0.2.0",
          migrationSteps: [
            "Rebuild generated tasks from the upgraded pack.",
            "Re-run pack evals before resuming active goals."
          ],
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

  it("requires force before upgrading a pack with active work", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-domain-upgrade-"));

    try {
      await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      await expect(
        upgradeDomainPack({
          cwd: workspace,
          ref: "repo-maintenance"
        })
      ).rejects.toThrow("still in use");
      await expect(
        upgradeDomainPack({
          cwd: workspace,
          ref: "repo-maintenance",
          force: true
        })
      ).resolves.toMatchObject({
        id: "repo-maintenance",
        activeGoals: 1,
        activeTasks: 1,
        forced: true
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
