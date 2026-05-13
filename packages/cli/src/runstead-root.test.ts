import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  requireRunsteadRootSync,
  requireRunsteadStateDb,
  requireRunsteadStateDbSync,
  resolveRunsteadRoot,
  resolveRunsteadRootSync
} from "./runstead-root.js";

describe("resolveRunsteadRoot", () => {
  it("prefers .runstead when both roots exist", async () => {
    const workspace = join(tmpdir(), `runstead-root-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await mkdir(join(workspace, ".team"), { recursive: true });
      await writeFile(join(workspace, ".runstead", "config.yaml"), "version: 1\n");
      await writeFile(join(workspace, ".team", "config.yaml"), "version: 1\n");

      await expect(resolveRunsteadRoot(workspace)).resolves.toEqual({
        cwd: workspace,
        root: join(workspace, ".runstead"),
        source: "runstead"
      });
      expect(resolveRunsteadRootSync(workspace)).toEqual({
        cwd: workspace,
        root: join(workspace, ".runstead"),
        source: "runstead"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("falls back to legacy .team", async () => {
    const workspace = join(tmpdir(), `runstead-root-team-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".team"), { recursive: true });
      await writeFile(join(workspace, ".team", "config.yaml"), "version: 1\n");

      await expect(resolveRunsteadRoot(workspace)).resolves.toEqual({
        cwd: workspace,
        root: join(workspace, ".team"),
        source: "team"
      });
      expect(resolveRunsteadRootSync(workspace)).toEqual({
        cwd: workspace,
        root: join(workspace, ".team"),
        source: "team"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requires initialization and an existing state database", async () => {
    const workspace = join(tmpdir(), `runstead-root-state-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });

      expect(() => requireRunsteadRootSync(workspace)).toThrow(
        `Runstead is not initialized at ${join(workspace, ".runstead")}`
      );

      await mkdir(join(workspace, ".runstead"), { recursive: true });
      await writeFile(join(workspace, ".runstead", "config.yaml"), "version: 1\n");

      expect(() => requireRunsteadStateDbSync(workspace)).toThrow(
        `Runstead state database is missing at ${join(workspace, ".runstead", "state.db")}`
      );
      await expect(requireRunsteadStateDb(workspace)).rejects.toThrow(
        `Runstead state database is missing at ${join(workspace, ".runstead", "state.db")}`
      );

      await writeFile(join(workspace, ".runstead", "state.db"), "");

      expect(requireRunsteadStateDbSync(workspace)).toEqual({
        cwd: workspace,
        root: join(workspace, ".runstead"),
        source: "runstead",
        stateDb: join(workspace, ".runstead", "state.db")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
