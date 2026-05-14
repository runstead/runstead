import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireManagerLock, type Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import { exportAuditLog } from "./audit-export.js";
import { initRunstead } from "./init.js";
import { createCiRepairTaskFromWorkflowRun } from "./ci-repair.js";
import {
  formatCiRepairOrchestratorReport,
  runCiRepairOrchestrator
} from "./ci-repair-orchestrator.js";
import { runOnce } from "./run.js";
import { startWorkerRun } from "./runtime-audit.js";
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
      expect(verifierCalls[0]?.claim).toBe(false);
      expect(workerCalls[0]).toContain("Repair GitHub Actions run 123.");
      expect(formatCiRepairOrchestratorReport(first)).toContain(
        `waiting approval ${first.approval?.id}`
      );

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const toolCalls = database
          .prepare("SELECT action_type, status FROM tool_calls ORDER BY started_at, id")
          .all() as { action_type: string; status: string }[];
        const workerToolCall = database
          .prepare(
            `
            SELECT output_json
            FROM tool_calls
            WHERE action_type = 'worker.external.start' AND status = 'completed'
          `
          )
          .get() as { output_json: string };
        const workerToolOutput = JSON.parse(workerToolCall.output_json) as {
          stdout?: string;
          stdoutBytes: number;
          stdoutOmitted: boolean;
          args: string[];
        };
        const taskState = database
          .prepare("SELECT output_json FROM tasks WHERE id = ?")
          .get(first.ciRepair.task.id) as { output_json: string };

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
        expect(workerToolOutput.stdout).toBeUndefined();
        expect(workerToolOutput.stdoutBytes).toBeGreaterThan(0);
        expect(workerToolOutput.stdoutOmitted).toBe(true);
        expect(JSON.stringify(workerToolOutput)).not.toContain("fixed");
        expect(taskState.output_json).not.toContain("fixed");
        expect(taskState.output_json).toContain("omitted from Runstead durable state");
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

      const taskClaimedIndex = auditLog.entries.findIndex(
        (entry) => entry.type === "task.claimed"
      );
      const branchCreateRequestIndex = auditLog.entries.findIndex(
        (entry) =>
          entry.type === "tool_call.requested" &&
          typeof entry.payload === "object" &&
          entry.payload !== null &&
          "actionType" in entry.payload &&
          entry.payload.actionType === "git.branch.create"
      );

      expect(auditLog.entries.map((entry) => entry.type)).toEqual(
        expect.arrayContaining([
          "task.claimed",
          "worker_run.started",
          "tool_call.requested",
          "policy.decision_recorded",
          "approval.requested"
        ])
      );
      expect(taskClaimedIndex).toBeGreaterThanOrEqual(0);
      expect(branchCreateRequestIndex).toBeGreaterThanOrEqual(0);
      expect(taskClaimedIndex).toBeLessThan(branchCreateRequestIndex);
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
      const prCreateArgs = githubCalls.find(
        (args) => args[0] === "pr" && args[1] === "create"
      );
      const bodyIndex = prCreateArgs?.indexOf("--body") ?? -1;
      const pullRequestBody =
        bodyIndex === -1 ? undefined : prCreateArgs?.[bodyIndex + 1];

      expect(pullRequestBody).toContain("## Evidence");
      expect(pullRequestBody).toContain(`- CI log: ${third.ciRepair.evidence.id}`);
      expect(pullRequestBody).toContain("- test: ev_test");
      expect(pullRequestBody).toContain(
        `- Approval: ${second.approval.id} approved by local-admin`
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

  it("runs the default verifier path inside the orchestrator lock", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-default-verifier-"));

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          scripts: {
            test: 'node -e "process.exit(0)"'
          }
        })
      );

      const result = await runCiRepairOrchestrator({
        cwd: workspace,
        runId: "123",
        worker: "codex_cli",
        base: "main",
        allowedPaths: ["src/**"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        githubRunner: githubRunner([]),
        gitRunner: gitRunner([], { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner([]),
        now: new Date("2026-05-14T12:00:00.000Z")
      });

      expect(result.status).toBe("waiting_approval");
      expect(result.verifierResult?.task.status).toBe("waiting_approval");
      expect(result.verifierResult?.commandResults).toMatchObject([
        {
          verifier: "test",
          exitCode: 0,
          timedOut: false
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not start a duplicate orchestrator for an already running repair task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-duplicate-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      const ciRepair = await createCiRepairTaskFromWorkflowRun({
        cwd: workspace,
        runId: "123",
        runner: githubRunner([]),
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        now: new Date("2026-05-14T12:00:00.000Z")
      });
      const database = openRunsteadDatabase(ciRepair.stateDb);

      try {
        startWorkerRun({
          database,
          task: ciRepair.task,
          workerType: "ci_repair_orchestrator",
          enforcementLevel: "policy_enforced",
          now: new Date("2026-05-14T12:01:00.000Z")
        });
      } finally {
        database.close();
      }

      await expect(
        runCiRepairOrchestrator({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          base: "main",
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          githubRunner: githubRunner([]),
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
          workerRunner: workerRunner([]),
          verifierRunner: verifierRunner([]),
          now: new Date("2026-05-14T12:02:00.000Z")
        })
      ).rejects.toThrow("already has a running CI repair orchestrator");

      expect(gitCalls).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refuses to orchestrate while another manager holds the workspace lock", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-lock-"));
    const gitCalls: string[][] = [];

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });
      const lock = await acquireManagerLock({
        lockPath: join(initialized.root, "manager.lock"),
        ownerId: "test-manager"
      });

      try {
        await expect(
          runCiRepairOrchestrator({
            cwd: workspace,
            runId: "123",
            worker: "codex_cli",
            base: "main",
            verifierCommands: [{ name: "test", command: "pnpm test" }],
            githubRunner: githubRunner([]),
            gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
            workerRunner: workerRunner([]),
            verifierRunner: verifierRunner([]),
            now: new Date("2026-05-14T12:02:00.000Z")
          })
        ).rejects.toThrow("Runstead manager lock is already held");
      } finally {
        await lock.release();
      }

      expect(gitCalls).toEqual([]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("resumes approved CI repair publishing from run once", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-run-once-"));
    const githubCalls: string[][] = [];
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
        githubRunner: githubRunner(githubCalls),
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

      const second = await runOnce({
        cwd: workspace,
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        now: new Date("2026-05-14T12:02:00.000Z")
      });

      if (!second.ranTask) {
        throw new Error("Expected run once to resume CI repair");
      }

      expect(second.task.type).toBe("ci_repair");
      expect(second.ciRepairResult?.status).toBe("waiting_approval");
      expect(second.ciRepairResult?.approval?.id).toMatch(/^appr_/);
      expect(gitCalls).toContainEqual([
        "push",
        "--set-upstream",
        "origin",
        first.branchName
      ]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        false
      );

      if (second.ciRepairResult?.approval === undefined) {
        throw new Error("Expected PR approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: second.ciRepairResult.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:03:00.000Z")
      });

      const third = await runOnce({
        cwd: workspace,
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        now: new Date("2026-05-14T12:04:00.000Z")
      });

      if (!third.ranTask) {
        throw new Error("Expected run once to finish CI repair");
      }
      const thirdCiRepair = third.ciRepairResult;

      if (thirdCiRepair === undefined) {
        throw new Error("Expected CI repair result");
      }

      expect(third.task.type).toBe("ci_repair");
      expect(third.task.status).toBe("completed");
      expect(thirdCiRepair.status).toBe("completed");
      expect(thirdCiRepair.pullRequest?.url).toBe("https://github.example/pr/1");
      const prCreateCall = githubCalls.find(
        (args) => args[0] === "pr" && args[1] === "create"
      );
      const bodyIndex = prCreateCall?.indexOf("--body") ?? -1;
      const body = bodyIndex < 0 ? "" : (prCreateCall?.[bodyIndex + 1] ?? "");

      expect(body).toContain("## Runstead Task");
      expect(body).toContain("## Worker");
      expect(body).toContain("- Worker: codex_cli");
      expect(body).toContain("## Diagnosis");
      expect(body).toContain("- Category: test");
      expect(body).toContain("## Verification");
      expect(body).toContain("- Diff scope: passed");
      expect(body).toContain("- Changed files: src/fix.ts");
      expect(body).toContain("- test: exit=0 evidence=ev_test");
      expect(body).toContain("## Policy");
      expect(body).toContain(
        `- Approval: ${second.ciRepairResult.approval.id} approved by local-admin`
      );
      expect(body).toContain("## Evidence");
      expect(body).toContain(thirdCiRepair.ciRepair.evidence.id);
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
        expect(
          showApproval({ cwd: workspace, id: first.approval.id }).approval.status
        ).toBe("expired");
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
          forceKilled: false,
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
