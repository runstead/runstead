import { describe, expect, it } from "vitest";

import {
  fetchGitHubWorkflowRunLog,
  formatWorkflowRunStatus,
  getGitHubWorkflowRunStatus,
  type GitHubCliRunner
} from "./github-actions.js";

describe("getGitHubWorkflowRunStatus", () => {
  it("loads workflow run status through gh", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const runner: GitHubCliRunner = (args, options) => {
      calls.push({ args, cwd: options.cwd });

      return Promise.resolve({
        stdout: JSON.stringify({
          databaseId: 123,
          workflowName: "Verify",
          displayTitle: "CI",
          status: "completed",
          conclusion: "failure",
          event: "push",
          headBranch: "main",
          headSha: "abc123",
          url: "https://github.com/acme/widgets/actions/runs/123"
        }),
        stderr: "",
        exitCode: 0
      });
    };

    await expect(
      getGitHubWorkflowRunStatus({
        cwd: "/repo",
        runId: "123",
        runner
      })
    ).resolves.toEqual({
      runId: "123",
      databaseId: 123,
      workflowName: "Verify",
      displayTitle: "CI",
      status: "completed",
      conclusion: "failure",
      event: "push",
      headBranch: "main",
      headSha: "abc123",
      url: "https://github.com/acme/widgets/actions/runs/123"
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        args: [
          "run",
          "view",
          "123",
          "--json",
          "databaseId,workflowName,displayTitle,status,conclusion,event,headBranch,headSha,url"
        ]
      }
    ]);
  });

  it("formats a concise status report", () => {
    expect(
      formatWorkflowRunStatus({
        runId: "123",
        workflowName: "Verify",
        status: "completed",
        conclusion: "success",
        headBranch: "main"
      })
    ).toContain("Status: completed");
  });

  it("fetches workflow run logs through gh", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const runner: GitHubCliRunner = (args, options) => {
      calls.push({ args, cwd: options.cwd });

      return Promise.resolve({
        stdout: "build\tstep\tfailing test\n",
        stderr: "",
        exitCode: 0
      });
    };

    await expect(
      fetchGitHubWorkflowRunLog({
        cwd: "/repo",
        runId: "123",
        runner
      })
    ).resolves.toEqual({
      runId: "123",
      log: "build\tstep\tfailing test\n",
      byteLength: 24
    });
    expect(calls).toEqual([
      {
        cwd: "/repo",
        args: ["run", "view", "123", "--log"]
      }
    ]);
  });
});
