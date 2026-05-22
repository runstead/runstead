import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { generateStartupLaunchGitSummary } from "./startup-launch-git.js";

const execFileAsync = promisify(execFile);

describe("startup launch git summary", () => {
  it("writes first commit, push, PR, and CI readiness guidance without git writes", async () => {
    const workspace = join(tmpdir(), `runstead-startup-launch-git-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(workspace, ".github", "workflows", "ci.yml"),
        "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n",
        "utf8"
      );
      await writeFile(join(workspace, "package.json"), '{"scripts":{}}\n', "utf8");
      await execFileAsync("git", ["init"], { cwd: workspace });
      await execFileAsync(
        "git",
        ["remote", "add", "origin", "https://github.com/leapvoid/todo.git"],
        { cwd: workspace }
      );
      await initRunstead({ cwd: workspace });

      const result = await generateStartupLaunchGitSummary({
        cwd: workspace,
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const markdown = await readFile(result.markdownPath, "utf8");
      const json = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
        remote: { github?: { owner: string; repo: string } };
        ciDetected: boolean;
        launchActions: string[];
      };
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const evidence = database
          .prepare("SELECT type, summary FROM evidence WHERE id = ?")
          .get(result.evidenceId) as { type: string; summary: string } | undefined;

        expect(result.summary.remote.github).toEqual({
          owner: "leapvoid",
          repo: "todo"
        });
        expect(result.summary.ciDetected).toBe(true);
        expect(result.summary.changedFiles).toEqual(
          expect.arrayContaining([".github/workflows/ci.yml", "package.json"])
        );
        expect(result.nextCommands).toEqual(
          expect.arrayContaining([
            "git commit -m 'Launch-ready MVP baseline'",
            `git push -u origin ${result.summary.branch ?? result.summary.recommendedBranch}`,
            "gh pr create --fill --draft"
          ])
        );
        expect(markdown).toContain("Git writes executed: no");
        expect(markdown).toContain("leapvoid/todo");
        expect(markdown).toContain(
          "This summary does not commit, push, or create a PR."
        );
        expect(json.remote.github).toEqual({ owner: "leapvoid", repo: "todo" });
        expect(json.ciDetected).toBe(true);
        expect(json.launchActions).toContain("gh pr create --fill --draft");
        expect(evidence).toMatchObject({
          type: "startup_launch_git_path",
          summary: "Git/GitHub launch path summary generated; no git writes executed"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
