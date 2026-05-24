import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  inferWorkspacePatchTouchedFiles,
  readManyWorkspaceFiles,
  searchWorkspaceText
} from "./codex-direct-native-tools.js";

describe("codex direct native tools", () => {
  it("infers touched files from unified diffs, replacements, and codex patch syntax", () => {
    expect(
      inferWorkspacePatchTouchedFiles({
        patch: [
          "diff --git a/src/old.ts b/src/new.ts",
          "--- a/src/old.ts",
          "+++ b/src/new.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new"
        ].join("\n")
      })
    ).toEqual(["src/old.ts", "src/new.ts"]);

    expect(
      inferWorkspacePatchTouchedFiles({
        replacements: [
          { path: "./src/app.ts", search: "old", replace: "new" },
          { path: "src/app.ts", search: "again", replace: "done" }
        ]
      })
    ).toEqual(["src/app.ts"]);

    expect(
      inferWorkspacePatchTouchedFiles({
        patch: [
          "*** Begin Patch",
          "*** Add File: package.json",
          "+{}",
          "*** Update File: src/app.js",
          "@@",
          "-old",
          "+new",
          "*** Move to: src/main.js",
          "*** Delete File: src/old.js",
          "*** End Patch"
        ].join("\n")
      })
    ).toEqual(["package.json", "src/app.js", "src/main.js", "src/old.js"]);
  });

  it("infers touched files from non-standard git diff path headers", () => {
    expect(
      inferWorkspacePatchTouchedFiles({
        patch: [
          "diff --git /dev/null src/App.tsx",
          "new file mode 100644",
          "index 0000000..1111111",
          "@@ -0,0 +1 @@",
          "+export function App() { return null; }"
        ].join("\n")
      })
    ).toEqual(["src/App.tsx"]);

    expect(
      inferWorkspacePatchTouchedFiles({
        patch: [
          'diff --git "a/src/my file.ts" "b/src/my file.ts"',
          "index 1111111..2222222 100644",
          "@@ -1 +1 @@",
          "-old",
          "+new"
        ].join("\n")
      })
    ).toEqual(["src/my file.ts"]);

    expect(
      inferWorkspacePatchTouchedFiles({
        patch: [
          "diff --git a/src/old.ts b/src/new.ts",
          "similarity index 92%",
          "rename from src/old.ts",
          "rename to src/new.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new"
        ].join("\n")
      })
    ).toEqual(["src/old.ts", "src/new.ts"]);
  });

  it("reports symlink escapes for multi-file reads and rejects structured patches", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      const outside = join(root, "outside.txt");
      await mkdir(workspace);
      await writeFile(outside, "outside-secret\n", "utf8");
      await symlink(outside, join(workspace, "leak.txt"));

      const readResult = await readManyWorkspaceFiles(workspace, {
        paths: ["leak.txt"]
      });

      expect(readResult.files).toEqual([]);
      expect(readResult.errors).toEqual([
        {
          path: "leak.txt",
          error: "Workspace path crosses symlink: leak.txt"
        }
      ]);
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

      const result = await readManyWorkspaceFiles(workspace, {
        paths: ["linked/secret.txt"]
      });

      expect(result.files).toEqual([]);
      expect(result.errors).toEqual([
        {
          path: "linked/secret.txt",
          error: "Workspace path crosses symlink: linked/secret.txt"
        }
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("continues multi-file reads when one requested file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      await writeFile(join(workspace, "present.txt"), "present\n", "utf8");

      const result = await readManyWorkspaceFiles(workspace, {
        paths: ["missing.txt", "present.txt"]
      });

      expect(result.files).toMatchObject([
        {
          path: "present.txt",
          content: "present\n",
          truncated: false
        }
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe("missing.txt");
      expect(result.errors[0]?.error).toContain("ENOENT");
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

  it("skips files that exceed the search scan byte limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "runstead-native-tools-"));

    try {
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      await writeFile(join(workspace, "small.txt"), "needle\n", "utf8");
      await writeFile(
        join(workspace, "large.txt"),
        `${"x".repeat(64)}needle\n`,
        "utf8"
      );

      const result = await searchWorkspaceText(workspace, {
        query: "needle",
        maxBytesPerFile: 16
      });

      expect(result.matches.map((match) => match.path)).toEqual(["small.txt"]);
      expect(result.filesSkippedTooLarge).toBe(1);
      expect(result.maxBytesPerFile).toBe(16);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
