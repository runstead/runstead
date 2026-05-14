import { describe, expect, it } from "vitest";

import {
  buildRunsteadBranchName,
  createGitBranch,
  pushGitBranch,
  type GitRunner
} from "./git-branch.js";

describe("buildRunsteadBranchName", () => {
  it("normalizes runstead branch names", () => {
    expect(
      buildRunsteadBranchName({
        taskId: "task_ABC123",
        slug: "Fix CI Failure"
      })
    ).toBe("runstead/task_abc123/fix-ci-failure");
  });
});

describe("createGitBranch", () => {
  it("creates a branch from a base ref without forcing", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const runner: GitRunner = (args, options) => {
      calls.push({ args, cwd: options.cwd });

      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await expect(
      createGitBranch({
        cwd: "/repo",
        branchName: "Runstead/Task 123",
        baseRef: "main",
        runner
      })
    ).resolves.toEqual({
      cwd: "/repo",
      branchName: "runstead/task-123",
      baseRef: "main"
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        args: ["switch", "-c", "runstead/task-123", "main"]
      }
    ]);
  });
});

describe("pushGitBranch", () => {
  it("pushes a normalized branch to origin with upstream tracking", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const runner: GitRunner = (args, options) => {
      calls.push({ args, cwd: options.cwd });

      return Promise.resolve({
        stdout: "branch pushed\n",
        stderr: "",
        exitCode: 0
      });
    };

    await expect(
      pushGitBranch({
        cwd: "/repo",
        branchName: "Runstead/Task 123",
        runner
      })
    ).resolves.toEqual({
      cwd: "/repo",
      branchName: "runstead/task-123",
      remote: "origin",
      stdout: "branch pushed\n"
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        args: ["push", "--set-upstream", "origin", "runstead/task-123"]
      }
    ]);
  });
});
