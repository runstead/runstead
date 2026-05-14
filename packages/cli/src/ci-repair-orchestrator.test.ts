import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import { exportAuditLog } from "./audit-export.js";
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
  it("pauses PR creation for approval and resumes after approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-orchestrator-"));
    const now = new Date("2026-05-14T12:00:00.000Z");
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const workerCalls: string[] = [];
    const verifierCalls: RunTaskVerifiersOptions[] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      const first = await runCiRepairOrchestrator({
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

      expect(first.status).toBe("waiting_approval");
      expect(first.ciRepair.workflowRun.runId).toBe("123");
      expect(first.branchName).toMatch(/^runstead\/task_/);
      expect(first.workerResult?.checkpointBefore?.id).toMatch(/^chk_/);
      expect(first.diffScope).toMatchObject({
        passed: true,
        changedFiles: ["src/fix.ts"]
      });
      expect(first.verifierResult?.task.status).toBe("waiting_approval");
      expect(first.pullRequest).toBeUndefined();
      expect(first.approval?.id).toMatch(/^appr_/);
      expect(gitCalls).toContainEqual(["switch", "-c", first.branchName, "main"]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        false
      );
      expect(verifierCalls).toHaveLength(1);
      expect(verifierCalls[0]?.taskId).toBe(first.ciRepair.task.id);
      expect(workerCalls[0]).toContain("Repair GitHub Actions run 123.");
      expect(formatCiRepairOrchestratorReport(first)).toContain(
        `waiting approval ${first.approval?.id}`
      );

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];

        expect(toolCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action_type: "github.run.read",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "github.run.log.read",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "git.branch.create",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "checkpoint.create",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "worker.external.start",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "git.diff",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "git.push",
              status: "approval_required"
            })
          ])
        );
      } finally {
        database.close();
      }
      const auditLog = await exportAuditLog({ cwd: workspace });
      const requestedActions = auditLog.entries
        .filter((entry) => entry.type === "tool_call.requested")
        .map((entry) =>
          typeof entry.payload === "object" &&
          entry.payload !== null &&
          "actionType" in entry.payload
            ? entry.payload.actionType
            : undefined
        );

      expect(auditLog.entries.map((entry) => entry.type)).toEqual(
        expect.arrayContaining([
          "worker_run.started",
          "tool_call.requested",
          "policy.decision_recorded",
          "approval.requested"
        ])
      );
      expect(requestedActions).toEqual(
        expect.arrayContaining([
          "github.run.read",
          "github.run.log.read",
          "git.branch.create",
          "checkpoint.create",
          "worker.external.start",
          "git.diff",
          "git.push"
        ])
      );

      if (first.approval === undefined) {
        throw new Error("Expected PR approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: first.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:01:00.000Z")
      });

      const second = await runCiRepairOrchestrator({
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
        now: new Date("2026-05-14T12:02:00.000Z")
      });

      expect(second.status).toBe("waiting_approval");
      expect(second.pullRequest).toBeUndefined();
      expect(second.approval?.id).toMatch(/^appr_/);
      expect(gitCalls).toContainEqual([
        "push",
        "--set-upstream",
        "origin",
        first.branchName
      ]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        false
      );
      expect(
        gitCalls.filter((args) => args[0] === "switch" && args[1] === "-c")
      ).toHaveLength(1);
      expect(
        showApproval({ cwd: workspace, id: first.approval.id }).approval.status
      ).toBe("expired");

      if (second.approval === undefined) {
        throw new Error("Expected PR approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: second.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:03:00.000Z")
      });

      const third = await runCiRepairOrchestrator({
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
        now: new Date("2026-05-14T12:04:00.000Z")
      });

      expect(third.status).toBe("completed");
      expect(third.pullRequest?.url).toBe("https://github.example/pr/1");
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        true
      );
      expect(gitCalls.filter((args) => args[0] === "push")).toHaveLength(1);
      expect(
        showApproval({ cwd: workspace, id: second.approval.id }).approval.status
      ).toBe("expired");
      const finalAuditLog = await exportAuditLog({ cwd: workspace });
      const finalRequestedActions = finalAuditLog.entries
        .filter((entry) => entry.type === "tool_call.requested")
        .map((entry) =>
          typeof entry.payload === "object" &&
          entry.payload !== null &&
          "actionType" in entry.payload
            ? entry.payload.actionType
            : undefined
        );

      expect(finalRequestedActions).toEqual(
        expect.arrayContaining(["git.push", "github.pr.create"])
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

  it("marks task and worker failed when approved branch push fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-push-failure-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      const first = await runCiRepairOrchestrator({
        cwd: workspace,
        runId: "123",
        worker: "codex_cli",
        base: "main",
        allowedPaths: ["src/**"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        githubRunner: githubRunner([]),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner([]),
        verifierRunner: verifierRunner([]),
        now: new Date("2026-05-14T12:00:00.000Z")
      });

      expect(first.status).toBe("waiting_approval");

      if (first.approval === undefined) {
        throw new Error("Expected push approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: first.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:01:00.000Z")
      });

      await expect(
        runCiRepairOrchestrator({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          base: "main",
          allowedPaths: ["src/**"],
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          githubRunner: githubRunner([]),
          gitRunner: gitRunner(gitCalls, {
            diffNameOnly: "src/fix.ts\n",
            pushExitCode: 1,
            pushStderr: "permission denied\n"
          }),
          workerRunner: workerRunner([]),
          verifierRunner: verifierRunner([]),
          now: new Date("2026-05-14T12:02:00.000Z")
        })
      ).rejects.toThrow("git push failed");

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const task = database
          .prepare("SELECT status, output_json FROM tasks WHERE id = ?")
          .get(first.ciRepair.task.id) as { status: string; output_json: string };
        const taskOutput = JSON.parse(task.output_json) as {
          summary?: string;
          error?: string;
        };
        const workerRuns = database
          .prepare(
            "SELECT worker_type, status, output_json FROM worker_runs ORDER BY started_at, id"
          )
          .all() as {
          worker_type: string;
          status: string;
          output_json: string | null;
        }[];
        const pushCalls = database
          .prepare(
            "SELECT status, output_json FROM tool_calls WHERE action_type = 'git.push' ORDER BY started_at, id"
          )
          .all() as { status: string; output_json: string | null }[];
        const lastWorkerRun = workerRuns.at(-1);
        const lastWorkerOutput = JSON.parse(lastWorkerRun?.output_json ?? "{}") as {
          summary?: string;
          error?: string;
        };
        const failedPushOutput = JSON.parse(pushCalls.at(-1)?.output_json ?? "{}") as {
          error?: string;
        };

        expect(task.status).toBe("failed");
        expect(taskOutput.summary).toBe("CI repair publish failed");
        expect(taskOutput.error).toContain("git push failed");
        expect(lastWorkerRun).toMatchObject({
          worker_type: "ci_repair_orchestrator",
          status: "failed"
        });
        expect(lastWorkerOutput.summary).toBe("CI repair publish failed");
        expect(lastWorkerOutput.error).toContain("git push failed");
        expect(pushCalls.map((call) => call.status)).toEqual([
          "approval_required",
          "failed"
        ]);
        expect(failedPushOutput.error).toContain("git push failed");
      } finally {
        database.close();
      }
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
  output: { diffNameOnly: string; pushExitCode?: number; pushStderr?: string }
): GitRunner {
  return (args) => {
    calls.push(args);

    if (args[0] === "switch") {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }

    if (args[0] === "push") {
      return Promise.resolve({
        stdout: output.pushExitCode === undefined ? "pushed\n" : "",
        stderr: output.pushStderr ?? "",
        exitCode: output.pushExitCode ?? 0
      });
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
        return Promise.resolve({
          stdout: "",
          stderr: "unexpected git call",
          exitCode: 1
        });
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
