import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { migrateRunsteadState } from "./migrate.js";

describe("migrateRunsteadState", () => {
  it("copies .team state into .runstead by default", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".team"), { recursive: true });
      await writeFile(join(workspace, ".team", "config.yaml"), "version: 1\n");

      const result = await migrateRunsteadState({ cwd: workspace });

      expect(result.overwritten).toBe(false);
      expect(result.source).toBe(join(workspace, ".team"));
      expect(result.destination).toBe(join(workspace, ".runstead"));
      await expect(
        readFile(join(workspace, ".runstead", "config.yaml"), "utf8")
      ).resolves.toBe("version: 1\n");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refuses to overwrite an existing destination without force", async () => {
    const workspace = join(tmpdir(), `runstead-migrate-existing-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".team"), { recursive: true });
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
      await mkdir(join(workspace, ".team"), { recursive: true });
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(join(workspace, ".team", "config.yaml"), "new\n");
      await writeFile(join(workspace, ".runstead", "config.yaml"), "old\n");

      const result = await migrateRunsteadState({ cwd: workspace, force: true });

      expect(result.overwritten).toBe(true);
      await expect(
        readFile(join(workspace, ".runstead", "config.yaml"), "utf8")
      ).resolves.toBe("new\n");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
