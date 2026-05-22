import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { migrateRunsteadState } from "./migrate.js";

describe("migrateRunsteadState", () => {
  it("copies .team state into .runstead by default", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await createLegacyTeamState(workspace);

      const result = await migrateRunsteadState({ cwd: workspace });

      expect(result.overwritten).toBe(false);
      expect(result.source).toBe(join(workspace, ".team"));
      expect(result.destination).toBe(join(workspace, ".runstead"));
      expect(result.validation.every((check) => check.status === "pass")).toBe(true);
      expect(result.validation.map((check) => check.id)).toEqual(
        expect.arrayContaining([
          "config",
          "domain-pack-validation",
          "policy-validation",
          "rbac-policy",
          "team-policy",
          "state-db"
        ])
      );
      await expect(
        readFile(join(workspace, ".runstead", "config.yaml"), "utf8")
      ).resolves.toContain("domain: repo-maintenance");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refuses to overwrite an existing destination without force", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-existing-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await createLegacyTeamState(workspace);
      await mkdir(join(workspace, ".runstead"), { recursive: true });

      await expect(migrateRunsteadState({ cwd: workspace })).rejects.toThrow(
        "Migration destination already exists"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("overwrites the destination when forced", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-force-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await createLegacyTeamState(workspace);
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      const migratedConfig = await readFile(
        join(workspace, ".team", "config.yaml"),
        "utf8"
      );
      await writeFile(
        join(workspace, ".team", "config.yaml"),
        `${migratedConfig}\n# migrated\n`
      );
      await writeFile(join(workspace, ".runstead", "config.yaml"), "old\n");

      const result = await migrateRunsteadState({ cwd: workspace, force: true });

      expect(result.overwritten).toBe(true);
      await expect(
        readFile(join(workspace, ".runstead", "config.yaml"), "utf8")
      ).resolves.toContain("# migrated");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects incomplete sources before overwriting the destination", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-invalid-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".team"), { recursive: true });
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(join(workspace, ".team", "config.yaml"), "version: 1\n");
      await writeFile(join(workspace, ".runstead", "config.yaml"), "old\n");

      await expect(
        migrateRunsteadState({ cwd: workspace, force: true })
      ).rejects.toThrow("Migration source is not a complete Runstead state");
      await expect(
        readFile(join(workspace, ".runstead", "config.yaml"), "utf8")
      ).resolves.toBe("old\n");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects legacy sources missing governance projection tables", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-schema-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await createLegacyTeamState(workspace);
      const database = openRunsteadDatabase(join(workspace, ".team", "state.db"));

      try {
        database.exec("DROP TABLE tool_calls");
      } finally {
        database.close();
      }

      await expect(migrateRunsteadState({ cwd: workspace })).rejects.toThrow(
        "Migration source is not a complete Runstead state: state-db"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects legacy sources with stale state migrations", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-stale-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await createLegacyTeamState(workspace);
      const database = new DatabaseSync(join(workspace, ".team", "state.db"));

      try {
        database.exec("DELETE FROM schema_migrations WHERE version = 2");
        database.exec("PRAGMA user_version = 1");
      } finally {
        database.close();
      }

      await expect(migrateRunsteadState({ cwd: workspace })).rejects.toThrow(
        "Migration source is not a complete Runstead state: state-db"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function createLegacyTeamState(workspace: string): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await initRunstead({ cwd: workspace });
  await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
    recursive: true
  });
  await rm(join(workspace, ".runstead"), { force: true, recursive: true });
}
