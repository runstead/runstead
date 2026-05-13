import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  inspectCiProvider,
  inspectGitRepository,
  inspectLintCommand,
  inspectPackageManager,
  inspectTestCommand
} from "./repo-inspection.js";

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
  }, 10000);
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

describe("inspectTestCommand", () => {
  it("detects a real package test script", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-test-command-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@11.1.1",
          scripts: {
            test: "vitest run"
          }
        }),
        "utf8"
      );

      const inspection = await inspectTestCommand(workspace);

      expect(inspection).toMatchObject({
        detected: true,
        scriptName: "test",
        command: "pnpm test",
        rawScript: "vitest run",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("ignores the default npm placeholder test script", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-test-command-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: {
            test: 'echo "Error: no test specified" && exit 1'
          }
        }),
        "utf8"
      );

      const inspection = await inspectTestCommand(workspace);

      expect(inspection).toMatchObject({
        detected: false,
        scriptName: "test",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns undetected when package.json has no test script", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-test-command-"));

    try {
      await writeFile(join(workspace, "package.json"), "{}", "utf8");

      const inspection = await inspectTestCommand(workspace);

      expect(inspection).toMatchObject({
        detected: false,
        scriptName: "test",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("inspectLintCommand", () => {
  it("detects a package lint script", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lint-command-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@11.1.1",
          scripts: {
            lint: "eslint src"
          }
        }),
        "utf8"
      );

      const inspection = await inspectLintCommand(workspace);

      expect(inspection).toMatchObject({
        detected: true,
        scriptName: "lint",
        command: "pnpm run lint",
        rawScript: "eslint src",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns undetected when package.json has no lint script", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-lint-command-"));

    try {
      await writeFile(join(workspace, "package.json"), "{}", "utf8");

      const inspection = await inspectLintCommand(workspace);

      expect(inspection).toMatchObject({
        detected: false,
        scriptName: "lint",
        packageJsonPath: join(workspace, "package.json")
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("inspectCiProvider", () => {
  it("detects GitHub Actions workflow files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-provider-"));
    const workflowsDir = join(workspace, ".github", "workflows");

    try {
      await mkdir(workflowsDir, { recursive: true });
      await writeFile(join(workflowsDir, "verify.yml"), "name: verify\n", "utf8");

      const inspection = await inspectCiProvider(workspace);

      expect(inspection).toEqual({
        detected: true,
        cwd: workspace,
        providers: [
          {
            provider: "github_actions",
            configPath: workflowsDir
          }
        ]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("detects conventional CI config files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-provider-"));
    const circleCiDir = join(workspace, ".circleci");

    try {
      await mkdir(circleCiDir, { recursive: true });
      await writeFile(join(circleCiDir, "config.yml"), "version: 2.1\n", "utf8");
      await writeFile(join(workspace, ".gitlab-ci.yml"), "test:\n", "utf8");

      const inspection = await inspectCiProvider(workspace);

      expect(inspection).toEqual({
        detected: true,
        cwd: workspace,
        providers: [
          {
            provider: "gitlab_ci",
            configPath: join(workspace, ".gitlab-ci.yml")
          },
          {
            provider: "circleci",
            configPath: join(circleCiDir, "config.yml")
          }
        ]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns undetected when no CI config exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-provider-"));

    try {
      const inspection = await inspectCiProvider(workspace);

      expect(inspection).toEqual({
        detected: false,
        cwd: workspace,
        providers: []
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
