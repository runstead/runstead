import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  readManyWorkspaceFiles,
  searchWorkspaceText
} from "./codex-direct-native-tools.js";

describe("codex direct native tools", () => {
  it("rejects symlink escapes for multi-file reads and structured patches", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside.txt");
      await mkdir(workspace);
      await writeFile(outside, "outside-secret\n", "utf8");
      await symlink(outside, join(workspace, "leak.txt"));

      await expect(
        readManyWorkspaceFiles(workspace, { paths: ["leak.txt"] })
      ).rejects.toThrow("Workspace path crosses symlink");
      await expect(
        applyWorkspacePatch(workspace, {
          replacements: [
            {
              path: "leak.txt",
              search: "outside",
              replace: "changed"
            }
          ]
        })
      ).rejects.toThrow("Workspace path crosses symlink");
      await expect(readFile(outside, "utf8")).resolves.toBe("outside-secret\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects symlink escapes through intermediate directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      const outsideDirectory = join(root, "outside");
      await mkdir(workspace);
      await mkdir(outsideDirectory);
      await writeFile(join(outsideDirectory, "secret.txt"), "outside-secret\n", "utf8");
      await symlink(outsideDirectory, join(workspace, "linked"));

      await expect(
        readManyWorkspaceFiles(workspace, { paths: ["linked/secret.txt"] })
      ).rejects.toThrow("Workspace path crosses symlink");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unified diffs that target symlinks before running git apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside.txt");
      await mkdir(workspace);
      await writeFile(outside, "outside-secret\n", "utf8");
      await symlink(outside, join(workspace, "leak.txt"));

      await expect(
        applyWorkspacePatch(workspace, {
          patch: [
            "diff --git a/leak.txt b/leak.txt",
            "--- a/leak.txt",
            "+++ b/leak.txt",
            "@@ -1 +1 @@",
            "-outside-secret",
            "+changed-secret",
            ""
          ].join("\n")
        })
      ).rejects.toThrow("Workspace path crosses symlink");
      await expect(readFile(outside, "utf8")).resolves.toBe("outside-secret\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("searches regular files without following symlink entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside.txt");
      await mkdir(workspace);
      await writeFile(join(workspace, "inside.txt"), "needle\n", "utf8");
      await writeFile(outside, "needle outside\n", "utf8");
      await symlink(outside, join(workspace, "linked.txt"));

      const result = await searchWorkspaceText(workspace, { query: "needle" });

      expect(result.matches.map((match) => match.path)).toEqual(["inside.txt"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
