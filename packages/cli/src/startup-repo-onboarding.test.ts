import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatStartupRepoOnboarding,
  prepareStartupRepoOnboarding
} from "./startup-repo-onboarding.js";

describe("startup repo onboarding", () => {
  it("detects empty repos, ignores Runstead state, and can generate CI", async () => {
    const workspace = join(tmpdir(), `runstead-startup-repo-onboarding-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });

      const result = await prepareStartupRepoOnboarding({
        cwd: workspace,
        writeCi: true,
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      const gitignore = await readFile(join(workspace, ".gitignore"), "utf8");
      const ci = await readFile(
        join(workspace, ".github", "workflows", "runstead-startup.yml"),
        "utf8"
      );
      const formatted = formatStartupRepoOnboarding(result);

      expect(result.emptyRepo).toBe(true);
      expect(result.suggestedTemplate).toBe("static-local-first-mvp");
      expect(result.gitignore).toMatchObject({
        ignoredRunstead: true,
        changed: true
      });
      expect(gitignore).toContain(".runstead/");
      expect(result.verifierContract).toEqual([
        { name: "test", command: "npm test", detected: false },
        { name: "lint", command: "npm run lint", detected: false },
        { name: "typecheck", command: "npm run typecheck", detected: false },
        { name: "build", command: "npm run build", detected: false }
      ]);
      expect(ci).toContain("name: Runstead Startup Verifiers");
      expect(ci).toContain("npm run build");
      expect(formatted).toContain("Empty repo: yes");
      expect(formatted).toContain("First commit commands:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses package.json scripts as the verifier contract without a lockfile", async () => {
    const workspace = join(tmpdir(), `runstead-startup-repo-package-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify(
          {
            scripts: {
              test: "vitest run",
              build: "vite build"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await prepareStartupRepoOnboarding({ cwd: workspace });

      expect(result.emptyRepo).toBe(false);
      expect(result.packageManager).toBe("npm");
      expect(result.packageManagerSource).toBe("package_json");
      expect(result.verifierContract).toEqual(
        expect.arrayContaining([
          { name: "test", command: "npm test", detected: true },
          { name: "build", command: "npm run build", detected: true }
        ])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
