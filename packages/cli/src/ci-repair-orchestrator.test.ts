import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  formatCiRepairOrchestratorReport,
  runCiRepairOrchestrator
} from "./ci-repair-orchestrator.js";
import type { GitRunner } from "./git-branch.js";
import type { GitHubCliRunner } from "./github-actions.js";
import type {
  RunTaskVerifiersOptions,
  RunTaskVerifiersResult
} from "./verifier-runner.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

describe("runCiRepairOrchestrator", () => {
  it("creates a repair task, branch, worker checkpoint, diff check, verifier, and PR", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-orchestrator-"));
    const now = new Date("2026-05-14T12:00:00.000Z");
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const workerCalls: string[] = [];
    const verifierCalls: RunTaskVerifiersOptions[] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      const result = await runCiRepairOrchestrator({
        cwd: workspace,
        runId: "123",
        worker: "codex_cli",
        base: "main",
        allowedPaths: ["src/**"],
        deniedPaths: [".env"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner(workerCalls),
        verifierRunner: verifierRunner(verifierCalls),
        now
      });

      expect(result.ciRepair.workflowRun.runId).toBe("123");
      expect(result.branchName).toMatch(/^runstead\/task_/);
      expect(result.workerResult.checkpointBefore?.id).toMatch(/^chk_/);
      expect(result.diffScope).toMatchObject({
        passed: true,
        changedFiles: ["src/fix.ts"]
      });
      expect(result.verifierResult.task.status).toBe("completed");
      expect(result.pullRequest.url).toBe("https://github.example/pr/1");
      expect(gitCalls).toContainEqual(["switch", "-c", result.branchName, "main"]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create"))
        .toBe(true);
      expect(verifierCalls).toHaveLength(1);
      expect(verifierCalls[0]?.taskId).toBe(result.ciRepair.task.id);
      expect(workerCalls[0]).toContain("Repair GitHub Actions run 123.");
      expect(formatCiRepairOrchestratorReport(result)).toContain(
        `Branch: ${result.branchName}`
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rolls back worker changes when diff scope verification fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-rollback-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      await expect(
        runCiRepairOrchestrator({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          base: "main",
          deniedPaths: ["secrets.env"],
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          githubRunner: githubRunner([]),
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "secrets.env\n" }),
          workerRunner: workerRunner([]),
          verifierRunner: verifierRunner([]),
          now: new Date("2026-05-14T12:00:00.000Z")
        })
      ).rejects.toThrow("CI repair diff scope failed");

      expect(gitCalls).toContainEqual(["reset", "--hard", "abc123"]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function githubRunner(calls: string[][]): GitHubCliRunner {
  return (args) => {
    calls.push(args);

    if (args[0] === "run" && args.includes("--json")) {
      return Promise.resolve({
        stdout: JSON.stringify({
          databaseId: 123,
          workflowName: "Verify",
          displayTitle: "failing build",
          status: "completed",
          conclusion: "failure",
          headBranch: "main",
          headSha: "abc123",
          url: "https://github.example/run/123"
        }),
        stderr: "",
        exitCode: 0
      });
    }

    if (args[0] === "run" && args.includes("--log")) {
      return Promise.resolve({
        stdout: "test failed\n",
        stderr: "",
        exitCode: 0
      });
    }

    if (args[0] === "pr" && args[1] === "create") {
      return Promise.resolve({
        stdout: "https://github.example/pr/1\n",
        stderr: "",
        exitCode: 0
      });
    }

    return Promise.resolve({ stdout: "", stderr: "unexpected gh call", exitCode: 1 });
  };
}

function gitRunner(
  calls: string[][],
  output: { diffNameOnly: string }
): GitRunner {
  return (args) => {
    calls.push(args);

    if (args[0] === "switch") {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }

    switch (args.join(" ")) {
      case "rev-parse HEAD":
        return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
      case "status --short":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      case "diff --binary HEAD":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      case "ls-files --others --exclude-standard -z":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      case "diff --name-only main...HEAD":
        return Promise.resolve({
          stdout: output.diffNameOnly,
          stderr: "",
          exitCode: 0
        });
      case "reset --hard abc123":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      default:
        return Promise.resolve({ stdout: "", stderr: "unexpected git call", exitCode: 1 });
    }
  };
}

function workerRunner(calls: string[]): WorkerProcessRunner {
  return (_command, args) => {
    calls.push(args.join("\n"));

    return Promise.resolve({
      stdout: '{"summary":"fixed"}',
      stderr: "",
      exitCode: 0
    });
  };
}

function verifierRunner(
  calls: RunTaskVerifiersOptions[]
): (options: RunTaskVerifiersOptions) => Promise<RunTaskVerifiersResult> {
  return (options) => {
    calls.push(options);

    return Promise.resolve({
      task: completedVerifierTask(options.taskId),
      commandResults: [
        {
          verifier: "test",
          exitCode: 0,
          timedOut: false,
          evidenceId: "ev_test"
        }
      ]
    });
  };
}

function completedVerifierTask(taskId: string): Task {
  return {
    id: taskId,
    goalId: "goal_repo_maintenance",
    domain: "repo-maintenance",
    type: "ci_repair",
    status: "completed",
    priority: "high",
    attempt: 1,
    maxAttempts: 1,
    input: {},
    output: {},
    verifiers: ["command:test"],
    createdAt: "2026-05-14T12:00:00.000Z",
    updatedAt: "2026-05-14T12:00:00.000Z"
  };
}
