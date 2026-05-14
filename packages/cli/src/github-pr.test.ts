import { describe, expect, it } from "vitest";

import { buildPullRequestBody, createGitHubPullRequest } from "./github-pr.js";
import type { GitHubCliRunner } from "./github-actions.js";

describe("buildPullRequestBody", () => {
  it("includes task, goal, and evidence references", () => {
    expect(
      buildPullRequestBody({
        body: "Fixes the failing CI verifier.",
        goalId: "goal_123",
        taskId: "task_456",
        evidence: [
          {
            id: "ev_1",
            type: "command_output",
            summary: "pnpm test passed",
            uri: "file:///repo/.runstead/evidence/test.json"
          }
        ]
      })
    ).toContain("ev_1 (command_output): pnpm test passed");
  });
});

describe("createGitHubPullRequest", () => {
  it("creates a PR with an evidence-backed body", async () => {
    const calls: { args: string[]; cwd: string; env?: Record<string, string> }[] = [];
    const runner: GitHubCliRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        ...(options.env === undefined ? {} : { env: options.env })
      });

      return Promise.resolve({
        stdout: "https://github.com/acme/widgets/pull/42\n",
        stderr: "",
        exitCode: 0
      });
    };

    await expect(
      createGitHubPullRequest({
        cwd: "/repo",
        title: "Fix CI",
        base: "main",
        head: "runstead/task-1",
        taskId: "task_1",
        authToken: "ghs_app_token",
        evidence: [
          {
            id: "ev_1",
            type: "command_output",
            summary: "pnpm test passed"
          }
        ],
        runner
      })
    ).resolves.toEqual({
      cwd: "/repo",
      title: "Fix CI",
      base: "main",
      head: "runstead/task-1",
      url: "https://github.com/acme/widgets/pull/42",
      stdout: "https://github.com/acme/widgets/pull/42\n"
    });
    expect(calls[0]?.env).toEqual({
      GH_TOKEN: "ghs_app_token"
    });
    expect(calls[0]?.args).toEqual([
      "pr",
      "create",
      "--title",
      "Fix CI",
      "--body",
      expect.stringContaining("ev_1 (command_output): pnpm test passed"),
      "--base",
      "main",
      "--head",
      "runstead/task-1"
    ]);
  });
});
