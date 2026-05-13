import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveRunsteadRoot, resolveRunsteadRootSync } from "./runstead-root.js";

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
});
