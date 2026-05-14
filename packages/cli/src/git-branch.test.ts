import { describe, expect, it } from "vitest";

import {
  buildRunsteadBranchName,
  commitGitChanges,
  createGitBranch,
  listGitChangedFiles,
  pushGitBranch,
  redactGitOutput,
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
    const calls: { args: string[]; cwd: string; timeoutMs?: number }[] = [];
    const runner: GitRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

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
        timeoutMs: 60000,
        args: ["switch", "-c", "runstead/task-123", "main"]
      }
    ]);
  });
});

describe("pushGitBranch", () => {
  it("pushes a normalized branch to origin with upstream tracking", async () => {
    const calls: { args: string[]; cwd: string; timeoutMs?: number }[] = [];
    const runner: GitRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

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
        timeoutMs: 60000,
        args: ["push", "--set-upstream", "origin", "runstead/task-123"]
      }
    ]);
  });

  it("redacts credentials from git push failures and output", async () => {
    await expect(
      pushGitBranch({
        cwd: "/repo",
        branchName: "runstead/task-1",
        runner: () =>
          Promise.resolve({
            stdout: "",
            stderr:
              "fatal: https://user:ghp_abcdefghijklmnopqrstuvwxyz@github.com/acme/repo.git rejected",
            exitCode: 1
          })
      })
    ).rejects.toThrow(
      "https://[REDACTED_GIT_CREDENTIAL]@github.com/acme/repo.git rejected"
    );
    expect(
      redactGitOutput(
        "remote: github_pat_abcdefghijklmnopqrstuvwxyz from https://x:y@example.com/repo.git"
      )
    ).toBe(
      "remote: [REDACTED_GITHUB_TOKEN] from https://[REDACTED_GIT_CREDENTIAL]@example.com/repo.git"
    );
  });
});

describe("listGitChangedFiles", () => {
  it("collects tracked, staged, and untracked changed files", async () => {
    const runner: GitRunner = (args) => {
      switch (args.join(" ")) {
        case "diff --name-only":
          return Promise.resolve({
            stdout: "src/fix.ts\n.runstead/state.db\n",
            stderr: "",
            exitCode: 0
          });
        case "diff --cached --name-only":
          return Promise.resolve({
            stdout: "README.md\n",
            stderr: "",
            exitCode: 0
          });
        case "ls-files --others --exclude-standard":
          return Promise.resolve({
            stdout: "src/new.ts\nREADME.md\n",
            stderr: "",
            exitCode: 0
          });
        default:
          return Promise.resolve({
            stdout: "",
            stderr: "unexpected git call",
            exitCode: 1
          });
      }
    };

    await expect(
      listGitChangedFiles({
        cwd: "/repo",
        runner
      })
    ).resolves.toEqual({
      cwd: "/repo",
      changedFiles: ["src/fix.ts", ".runstead/state.db", "README.md", "src/new.ts"],
      trackedFiles: ["src/fix.ts", ".runstead/state.db"],
      stagedFiles: ["README.md"],
      untrackedFiles: ["src/new.ts", "README.md"],
      excludedFiles: [".runstead/state.db"]
    });
  });
});

describe("commitGitChanges", () => {
  it("commits changed files while excluding Runstead runtime state", async () => {
    const calls: { args: string[]; cwd: string; timeoutMs?: number }[] = [];
    const runner: GitRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
      });

      switch (args.join(" ")) {
        case "add -- src/fix.ts src/new.ts":
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        case "diff --cached --name-only":
          return Promise.resolve({
            stdout: "src/fix.ts\nsrc/new.ts\n",
            stderr: "",
            exitCode: 0
          });
        case "commit --no-gpg-sign -m Runstead CI repair -- src/fix.ts src/new.ts":
          return Promise.resolve({
            stdout: "[runstead/test abc123] Runstead CI repair\n",
            stderr: "",
            exitCode: 0
          });
        case "rev-parse HEAD":
          return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
        default:
          return Promise.resolve({
            stdout: "",
            stderr: "unexpected git call",
            exitCode: 1
          });
      }
    };

    await expect(
      commitGitChanges({
        cwd: "/repo",
        message: "Runstead CI repair",
        changedFiles: ["src/fix.ts", ".runstead/state.db", "src/new.ts"],
        runner
      })
    ).resolves.toEqual({
      cwd: "/repo",
      message: "Runstead CI repair",
      commitSha: "abc123",
      changedFiles: ["src/fix.ts", ".runstead/state.db", "src/new.ts"],
      committedFiles: ["src/fix.ts", "src/new.ts"],
      stdout: "[runstead/test abc123] Runstead CI repair\n"
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["add", "--", "src/fix.ts", "src/new.ts"],
      ["diff", "--cached", "--name-only"],
      [
        "commit",
        "--no-gpg-sign",
        "-m",
        "Runstead CI repair",
        "--",
        "src/fix.ts",
        "src/new.ts"
      ],
      ["rev-parse", "HEAD"]
    ]);
  });

  it("fails when only runtime state changed", async () => {
    await expect(
      commitGitChanges({
        cwd: "/repo",
        message: "Runstead CI repair",
        changedFiles: [".runstead/state.db"],
        runner: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
      })
    ).rejects.toThrow("No committable git changes found");
  });
});
