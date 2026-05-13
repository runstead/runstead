import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { inspectGitRepository, inspectPackageManager } from "./repo-inspection.js";

const execFileAsync = promisify(execFile);

describe("inspectGitRepository", () => {
  it("returns false outside a git repository", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-no-git-"));

    try {
      const inspection = await inspectGitRepository(workspace);

      expect(inspection).toEqual({ isGitRepo: false });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("detects git root, current branch, and head sha", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-git-"));
    const nested = join(workspace, "nested");

    try {
      await mkdir(nested, { recursive: true });
      await runGit(["init"], workspace);
      await writeFile(join(workspace, "README.md"), "# Fixture\n", "utf8");
      await runGit(["add", "README.md"], workspace);
      await runGit(
        [
          "-c",
          "user.name=Runstead",
          "-c",
          "user.email=runstead@example.com",
          "commit",
          "-m",
          "initial"
        ],
        workspace
      );

      const inspection = await inspectGitRepository(nested);

      expect(inspection.isGitRepo).toBe(true);
      expect(inspection.root).toBe(await realpath(workspace));
      expect(inspection.branch).toBeTruthy();
      expect(inspection.headSha).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("inspectPackageManager", () => {
  it("prefers package.json packageManager over lockfiles", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-pm-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ packageManager: "pnpm@11.1.1" }),
        "utf8"
      );
      await writeFile(join(workspace, "package-lock.json"), "{}", "utf8");

      const inspection = await inspectPackageManager(workspace);

      expect(inspection).toMatchObject({
        detected: true,
        packageManager: "pnpm",
        source: "package_json",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("falls back to lockfile detection", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-pm-"));

    try {
      await writeFile(join(workspace, "package.json"), "{}", "utf8");
      await writeFile(
        join(workspace, "pnpm-lock.yaml"),
        "lockfileVersion: 9\n",
        "utf8"
      );

      const inspection = await inspectPackageManager(workspace);

      expect(inspection).toMatchObject({
        detected: true,
        packageManager: "pnpm",
        source: "lockfile",
        packageJsonPath: join(workspace, "package.json"),
        lockfilePath: join(workspace, "pnpm-lock.yaml")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns undetected when no package metadata exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-pm-"));

    try {
      const inspection = await inspectPackageManager(workspace);

      expect(inspection).toEqual({
        detected: false,
        cwd: workspace
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    windowsHide: true
  });
}
