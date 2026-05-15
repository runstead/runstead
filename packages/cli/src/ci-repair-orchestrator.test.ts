import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireManagerLock, type Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import { exportAuditLog } from "./audit-export.js";
import { initRunstead } from "./init.js";
import {
  createCiRepairTaskFromWorkflowRun,
  isCreatedCiRepairTaskResult
} from "./ci-repair.js";
import {
  ciRepairProgressStageAtLeast,
  formatCiRepairOrchestratorReport,
  runCiRepairOrchestrator
} from "./ci-repair-orchestrator.js";
import { resumeInterruptedTasks } from "./resume.js";
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
  it("does not rank terminal stages as completed progress", () => {
    expect(ciRepairProgressStageAtLeast("completed", "branch_pushed")).toBe(true);
    expect(ciRepairProgressStageAtLeast("failed", "branch_pushed")).toBe(false);
    expect(ciRepairProgressStageAtLeast("blocked", "branch_pushed")).toBe(false);
    expect(ciRepairProgressStageAtLeast("cancelled", "branch_pushed")).toBe(false);
  });

  it("pauses PR creation for approval and resumes after approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-orchestrator-"));
    const now = new Date("2026-05-14T12:00:00.000Z");
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const workerCalls: string[] = [];
    const verifierCalls: RunTaskVerifiersOptions[] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });

      const workerApproval = await runCiRepairOrchestrator({
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

      expect(workerApproval.status).toBe("waiting_approval");
      expect(workerApproval.approval?.reason).toContain(
        "require_approval_external_worker_start"
      );
      expect(workerApproval.workerResult).toBeUndefined();
      expect(workerCalls).toHaveLength(0);

      await approveResultApproval({
        cwd: workspace,
        result: workerApproval,
        now: new Date("2026-05-14T12:00:30.000Z")
      });

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
        now: new Date("2026-05-14T12:01:00.000Z")
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
      expect(verifierCalls[0]?.mode).toBe("evidence_only");
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
        const stageRows = database
          .prepare(
            "SELECT payload_json FROM events WHERE aggregate_id = ? AND type = 'task.updated' ORDER BY id ASC"
          )
          .all(first.ciRepair.task.id) as { payload_json: string }[];
        const checkpointCreatedEvent = database
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'checkpoint.created'
          `
          )
          .get() as { payload_json: string };

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
              action_type: "git.status",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "git.commit",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "git.diff",
              status: "completed"
            }),
            expect.objectContaining({
              action_type: "repo.publish_repair",
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
        const taskOutput = JSON.parse(taskState.output_json) as {
          ciRepairOrchestrator?: {
            stage?: string;
            checkpointBefore?: { id?: string };
            workerResult?: { worker?: string };
            commit?: { commitSha?: string };
            diffScope?: { passed?: boolean };
            verifierCommandResults?: unknown[];
          };
        };
        const stages = stageRows
          .map((row) => JSON.parse(row.payload_json) as Record<string, unknown>)
          .map((payload) =>
            typeof payload.ciRepairOrchestrator === "object" &&
            payload.ciRepairOrchestrator !== null &&
            "stage" in payload.ciRepairOrchestrator
              ? payload.ciRepairOrchestrator.stage
              : undefined
          )
          .filter((stage): stage is string => typeof stage === "string");

        expect(taskOutput.ciRepairOrchestrator).toMatchObject({
          stage: "publish_approval_requested",
          checkpointBefore: { id: first.workerResult?.checkpointBefore?.id },
          workerResult: { worker: "codex_cli" },
          commit: { commitSha: "abc123" },
          diffScope: { passed: true }
        });
        expect(taskOutput.ciRepairOrchestrator?.verifierCommandResults).toHaveLength(1);
        expect(stages).toEqual(
          expect.arrayContaining([
            "intake_completed",
            "claimed",
            "branch_created",
            "checkpoint_created",
            "worker_completed",
            "committed",
            "verified",
            "ready_for_push"
          ])
        );
        expect(JSON.parse(checkpointCreatedEvent.payload_json)).toMatchObject({
          checkpointId: first.workerResult?.checkpointBefore?.id,
          actor: "runstead:ci-repair"
        });
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
          "git.status",
          "git.commit",
          "git.diff",
          "repo.publish_repair"
        ])
      );

      if (first.approval === undefined) {
        throw new Error("Expected publish approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: first.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:02:00.000Z")
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
        now: new Date("2026-05-14T12:03:00.000Z")
      });

      expect(second.status).toBe("completed");
      expect(second.pullRequest?.url).toBe("https://github.example/pr/1");
      expect(gitCalls).toContainEqual([
        "push",
        "--set-upstream",
        "origin",
        first.branchName
      ]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        true
      );
      expect(
        gitCalls.filter((args) => args[0] === "switch" && args[1] === "-c")
      ).toHaveLength(1);
      expect(
        showApproval({ cwd: workspace, id: first.approval.id }).approval.status
      ).toBe("expired");
      const prCreateArgs = githubCalls.find(
        (args) => args[0] === "pr" && args[1] === "create"
      );
      const bodyIndex = prCreateArgs?.indexOf("--body") ?? -1;
      const pullRequestBody =
        bodyIndex === -1 ? undefined : prCreateArgs?.[bodyIndex + 1];

      if (!isCreatedCiRepairTaskResult(second.ciRepair)) {
        throw new Error(
          `Expected created CI repair result, got ${second.ciRepair.status}`
        );
      }

      expect(pullRequestBody).toContain("## Evidence");
      expect(pullRequestBody).toContain(`- CI log: ${second.ciRepair.evidence.id}`);
      expect(pullRequestBody).toContain("- test: ev_test");
      expect(pullRequestBody).toContain("- Commit: abc123");
      expect(pullRequestBody).toContain(
        `- Approval: ${first.approval.id} approved by local-admin`
      );
      expect(gitCalls.filter((args) => args[0] === "push")).toHaveLength(1);
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
        expect.arrayContaining(["repo.publish_repair", "git.push", "github.pr.create"])
      );
      const finalDatabase = openRunsteadDatabase(
        join(workspace, ".runstead", "state.db")
      );

      try {
        const coveredSubActions = finalDatabase
          .prepare(
            `
            SELECT action_type, output_json, policy_decision_id
            FROM tool_calls
            WHERE action_type IN ('git.push', 'github.pr.create')
            ORDER BY started_at ASC, id ASC
          `
          )
          .all() as {
          action_type: string;
          output_json: string;
          policy_decision_id: string;
        }[];

        expect(coveredSubActions).toHaveLength(2);
        expect(coveredSubActions.map((row) => row.action_type).sort()).toEqual([
          "git.push",
          "github.pr.create"
        ]);
        for (const row of coveredSubActions) {
          const output = JSON.parse(row.output_json) as {
            coveredByActionType?: string;
            coveredByToolCallId?: string;
            coveredByPolicyDecisionId?: string;
            coveredByApprovalId?: string;
          };

          expect(row.policy_decision_id).toMatch(/^poldec_/);
          expect(output).toMatchObject({
            coveredByActionType: "repo.publish_repair",
            coveredByApprovalId: first.approval.id
          });
          expect(output.coveredByToolCallId).toMatch(/^tool_/);
          expect(output.coveredByPolicyDecisionId).toMatch(/^poldec_/);
        }
      } finally {
        finalDatabase.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rolls back worker changes when diff scope verification fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-rollback-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

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

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const restoredEvent = database
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'checkpoint.restored'
          `
          )
          .get() as { payload_json: string };

        expect(JSON.parse(restoredEvent.payload_json)).toMatchObject({
          currentHead: "abc123",
          restoredTrackedPatch: false,
          actor: "runstead:ci-repair"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("pauses dependency file commits for approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-dependency-"));
    const gitCalls: string[][] = [];
    const workerCalls: string[] = [];
    const verifierCalls: RunTaskVerifiersOptions[] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

      const result = await runCiRepairOrchestrator({
        cwd: workspace,
        runId: "123",
        worker: "codex_cli",
        base: "main",
        allowedPaths: ["package.json"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        githubRunner: githubRunner([]),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "package.json\n" }),
        workerRunner: workerRunner(workerCalls),
        verifierRunner: verifierRunner(verifierCalls),
        now: new Date("2026-05-14T12:05:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const policyDecision = database
          .prepare(
            "SELECT decision, risk, rule_id FROM policy_decisions WHERE rule_id = 'require_approval_dependency_file_commit'"
          )
          .get() as { decision: string; risk: string; rule_id: string };
        const storedTask = database
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(result.ciRepair.task.id) as { status: string };
        const workerRun = database
          .prepare(
            "SELECT status, output_json FROM worker_runs WHERE task_id = ? AND worker_type = 'ci_repair_orchestrator' ORDER BY started_at DESC, id DESC LIMIT 1"
          )
          .get(result.ciRepair.task.id) as {
          status: string;
          output_json: string;
        };

        expect(result.status).toBe("waiting_approval");
        expect(result.approval?.id).toMatch(/^appr_/);
        expect(result.approval?.reason).toContain(
          "require_approval_dependency_file_commit"
        );
        expect(result.workerResult?.exitCode).toBe(0);
        expect(gitCalls.some((args) => args[0] === "commit")).toBe(false);
        expect(verifierCalls).toHaveLength(0);
        expect(policyDecision).toEqual({
          decision: "require_approval",
          risk: "high",
          rule_id: "require_approval_dependency_file_commit"
        });
        expect(storedTask.status).toBe("waiting_approval");
        expect(workerRun.status).toBe("waiting_approval");
        expect(JSON.parse(workerRun.output_json)).toMatchObject({
          approvalId: result.approval?.id,
          actionType: "git.commit"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("resumes pre-publish stages without repeating completed side effects", async () => {
    const crashStages = [
      "branch_created",
      "checkpoint_created",
      "worker_completed",
      "committed",
      "verified",
      "ready_for_push"
    ];

    for (const crashStage of crashStages) {
      const workspace = await mkdtemp(
        join(tmpdir(), `runstead-ci-crash-${crashStage}-`)
      );
      const githubCalls: string[][] = [];
      const gitCalls: string[][] = [];
      const workerCalls: string[] = [];
      const verifierCalls: RunTaskVerifiersOptions[] = [];

      try {
        await initRunstead({ cwd: workspace, createDefaultGoal: true });
        await allowExternalWorkerStartForTest(workspace);

        await expect(
          runCiRepairOrchestrator({
            cwd: workspace,
            runId: "123",
            worker: "codex_cli",
            base: "main",
            allowedPaths: ["src/**"],
            verifierCommands: [{ name: "test", command: "pnpm test" }],
            githubRunner: githubRunner(githubCalls),
            gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
            workerRunner: workerRunner(workerCalls),
            verifierRunner: verifierRunner(verifierCalls),
            onStagePersisted: crashAfterStage(crashStage),
            now: new Date("2026-05-14T13:00:00.000Z")
          })
        ).rejects.toThrow(`crash after ${crashStage}`);

        const resumedTasks = await resumeInterruptedTasks({
          cwd: workspace,
          now: new Date("2026-05-14T13:01:00.000Z")
        });
        const resumed = await runOnce({
          cwd: workspace,
          base: "main",
          allowedPaths: ["src/**"],
          githubRunner: githubRunner(githubCalls),
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
          workerRunner: workerRunner(workerCalls),
          verifierRunner: verifierRunner(verifierCalls),
          now: new Date("2026-05-14T13:02:00.000Z")
        });

        if (!resumed.ranTask) {
          throw new Error("Expected run once to resume the interrupted task");
        }

        const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

        try {
          const checkpointCreates = database
            .prepare(
              "SELECT COUNT(*) AS count FROM tool_calls WHERE task_id = ? AND action_type = 'checkpoint.create'"
            )
            .get(resumed.task.id) as { count: number };
          const taskOutput = JSON.parse(
            (
              database
                .prepare("SELECT output_json FROM tasks WHERE id = ?")
                .get(resumed.task.id) as { output_json: string }
            ).output_json
          ) as { ciRepairOrchestrator?: { stage?: string } };

          expect(resumedTasks.requeuedTasks).toHaveLength(1);
          expect(resumed.task.status).toBe("waiting_approval");
          expect(taskOutput.ciRepairOrchestrator?.stage).toBe(
            "publish_approval_requested"
          );
          expect(
            gitCalls.filter((args) => args[0] === "switch" && args[1] === "-c")
          ).toHaveLength(1);
          expect(checkpointCreates.count).toBe(1);
          expect(workerCalls).toHaveLength(1);
          expect(gitCalls.filter((args) => args[0] === "commit")).toHaveLength(1);
          expect(verifierCalls).toHaveLength(1);
          expect(gitCalls.filter((args) => args[0] === "push")).toHaveLength(0);
          expect(
            githubCalls.filter((args) => args[0] === "pr" && args[1] === "create")
          ).toHaveLength(0);
        } finally {
          database.close();
        }
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    }
  });

  it("resumes after a branch push crash without pushing again", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-crash-push-"));
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];
    const workerCalls: string[] = [];
    const verifierCalls: RunTaskVerifiersOptions[] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

      const first = await runCiRepairOrchestrator({
        cwd: workspace,
        runId: "123",
        worker: "codex_cli",
        base: "main",
        allowedPaths: ["src/**"],
        verifierCommands: [{ name: "test", command: "pnpm test" }],
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner(workerCalls),
        verifierRunner: verifierRunner(verifierCalls),
        now: new Date("2026-05-14T13:10:00.000Z")
      });

      if (first.approval === undefined) {
        throw new Error("Expected push approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: first.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T13:11:00.000Z")
      });

      await expect(
        runCiRepairOrchestrator({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          base: "main",
          allowedPaths: ["src/**"],
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          githubRunner: githubRunner(githubCalls),
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
          workerRunner: workerRunner(workerCalls),
          verifierRunner: verifierRunner(verifierCalls),
          onStagePersisted: crashAfterStage("branch_pushed"),
          now: new Date("2026-05-14T13:12:00.000Z")
        })
      ).rejects.toThrow("crash after branch_pushed");

      const resumedTasks = await resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-14T13:13:00.000Z")
      });
      const resumed = await runOnce({
        cwd: workspace,
        base: "main",
        allowedPaths: ["src/**"],
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner(workerCalls),
        verifierRunner: verifierRunner(verifierCalls),
        now: new Date("2026-05-14T13:14:00.000Z")
      });

      if (!resumed.ranTask) {
        throw new Error("Expected run once to resume the branch-pushed task");
      }

      expect(resumedTasks.requeuedTasks).toHaveLength(1);
      expect(resumed.task.status).toBe("completed");
      expect(gitCalls.filter((args) => args[0] === "push")).toHaveLength(1);
      expect(
        githubCalls.filter((args) => args[0] === "pr" && args[1] === "create")
      ).toHaveLength(1);
      expect(resumed.ciRepairResult?.pullRequest?.url).toBe(
        "https://github.example/pr/1"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("resumes after publish approval is consumed before push", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-crash-publish-"));
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

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
        now: new Date("2026-05-14T13:20:00.000Z")
      });

      if (first.approval === undefined) {
        throw new Error("Expected publish approval request");
      }

      await decideApproval({
        cwd: workspace,
        id: first.approval.id,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T13:21:00.000Z")
      });

      await expect(
        runCiRepairOrchestrator({
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
          onStagePersisted: crashAfterStage("publish_approved"),
          now: new Date("2026-05-14T13:22:00.000Z")
        })
      ).rejects.toThrow("crash after publish_approved");

      const resumedTasks = await resumeInterruptedTasks({
        cwd: workspace,
        now: new Date("2026-05-14T13:23:00.000Z")
      });
      const resumed = await runOnce({
        cwd: workspace,
        base: "main",
        allowedPaths: ["src/**"],
        githubRunner: githubRunner(githubCalls),
        gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
        workerRunner: workerRunner([]),
        verifierRunner: verifierRunner([]),
        now: new Date("2026-05-14T13:24:00.000Z")
      });

      if (!resumed.ranTask) {
        throw new Error("Expected run once to resume the publish-approved task");
      }

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const approvalCount = database
          .prepare("SELECT COUNT(*) AS count FROM approvals")
          .get() as { count: number };
        const publishStatuses = database
          .prepare(
            "SELECT status FROM tool_calls WHERE action_type = 'repo.publish_repair' ORDER BY started_at, id"
          )
          .all() as { status: string }[];
        const gitPushes = gitCalls.filter((args) => args[0] === "push");

        expect(resumedTasks.requeuedTasks).toHaveLength(1);
        expect(resumed.task.status).toBe("completed");
        expect(resumed.ciRepairResult?.pullRequest?.url).toBe(
          "https://github.example/pr/1"
        );
        expect(approvalCount.count).toBe(1);
        expect(publishStatuses.map((row) => row.status)).toEqual([
          "approval_required",
          "completed"
        ]);
        expect(gitPushes).toHaveLength(1);
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

  it("fails before publish when the worker produces no branch diff", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-empty-diff-"));
    const githubCalls: string[][] = [];
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

      await expect(
        runCiRepairOrchestrator({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          base: "main",
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          githubRunner: githubRunner(githubCalls),
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "" }),
          workerRunner: workerRunner([]),
          verifierRunner: verifierRunner([]),
          now: new Date("2026-05-14T12:00:00.000Z")
        })
      ).rejects.toThrow("CI repair produced no git diff");

      expect(gitCalls.some((args) => args[0] === "push")).toBe(false);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        false
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs the default verifier path inside the orchestrator lock", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-default-verifier-"));

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);
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
      await allowExternalWorkerStartForTest(workspace);

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
      expect(second.task.status).toBe("completed");
      expect(second.ciRepairResult?.status).toBe("completed");
      expect(second.ciRepairResult?.pullRequest?.url).toBe(
        "https://github.example/pr/1"
      );
      expect(gitCalls).toContainEqual([
        "push",
        "--set-upstream",
        "origin",
        first.branchName
      ]);
      expect(githubCalls.some((args) => args[0] === "pr" && args[1] === "create")).toBe(
        true
      );
      const secondCiRepair = second.ciRepairResult;

      if (secondCiRepair === undefined) {
        throw new Error("Expected CI repair result");
      }

      const prCreateCall = githubCalls.find(
        (args) => args[0] === "pr" && args[1] === "create"
      );
      const bodyIndex = prCreateCall?.indexOf("--body") ?? -1;
      const body = bodyIndex < 0 ? "" : (prCreateCall?.[bodyIndex + 1] ?? "");

      expect(body).toContain("## Runstead Task");
      expect(body).toContain("## Worker");
      expect(body).toContain("- Worker: codex_cli");
      expect(body).toContain("- Commit: abc123");
      expect(body).toContain("## Diagnosis");
      expect(body).toContain("- Category: test");
      expect(body).toContain("## Verification");
      expect(body).toContain("- Diff scope: passed");
      expect(body).toContain("- Changed files: src/fix.ts");
      expect(body).toContain("- test: exit=0 evidence=ev_test");
      expect(body).toContain("## Policy");
      expect(body).toContain(
        `- Approval: ${first.approval.id} approved by local-admin`
      );
      expect(body).toContain(
        "- repo.publish_repair: completed policy=require_approval"
      );
      expect(body).toContain("- git.push: completed");
      expect(body).toContain("## Evidence");
      if (!isCreatedCiRepairTaskResult(secondCiRepair.ciRepair)) {
        throw new Error(
          `Expected created CI repair result, got ${secondCiRepair.ciRepair.status}`
        );
      }
      expect(body).toContain(secondCiRepair.ciRepair.evidence.id);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not let composite publish approval cover denied sub-actions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-deny-push-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);
      await denyPublishSubActionForTest(workspace, "git.push");

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

      if (first.approval === undefined) {
        throw new Error("Expected publish approval request");
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
          gitRunner: gitRunner(gitCalls, { diffNameOnly: "src/fix.ts\n" }),
          workerRunner: workerRunner([]),
          verifierRunner: verifierRunner([]),
          now: new Date("2026-05-14T12:02:00.000Z")
        })
      ).rejects.toThrow("git.push denied by policy");

      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const task = database
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(first.ciRepair.task.id) as { status: string };
        const pushCall = database
          .prepare(
            "SELECT status, policy_decision_id FROM tool_calls WHERE action_type = 'git.push'"
          )
          .get() as { status: string; policy_decision_id: string };
        const policyDecision = database
          .prepare("SELECT decision, rule_id FROM policy_decisions WHERE id = ?")
          .get(pushCall.policy_decision_id) as {
          decision: string;
          rule_id: string;
        };

        expect(task.status).toBe("blocked");
        expect(pushCall.status).toBe("denied");
        expect(policyDecision).toEqual({
          decision: "deny",
          rule_id: "deny_publish_subaction_git_push"
        });
        expect(gitCalls.filter((args) => args[0] === "push")).toHaveLength(0);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("marks task and worker failed when approved branch push fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-ci-push-failure-"));
    const gitCalls: string[][] = [];

    try {
      await initRunstead({ cwd: workspace, createDefaultGoal: true });
      await allowExternalWorkerStartForTest(workspace);

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
        expect(pushCalls.map((call) => call.status)).toEqual(["failed"]);
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

    if (args[0] === "add") {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }

    if (args[0] === "commit") {
      return Promise.resolve({
        stdout: "[runstead/test abc123] Runstead repair\n",
        stderr: "",
        exitCode: 0
      });
    }

    switch (args.join(" ")) {
      case "rev-parse HEAD":
        return Promise.resolve({ stdout: "abc123\n", stderr: "", exitCode: 0 });
      case "status --short":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      case "diff --name-only":
      case "diff --cached --name-only":
        return Promise.resolve({
          stdout: output.diffNameOnly,
          stderr: "",
          exitCode: 0
        });
      case "diff --binary HEAD":
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      case "ls-files --others --exclude-standard":
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

function crashAfterStage(stage: string): (persistedStage: string) => void {
  let crashed = false;

  return (persistedStage) => {
    if (!crashed && persistedStage === stage) {
      crashed = true;
      const error = new Error(`crash after ${stage}`);
      error.name = "RunsteadStagePersistenceInterruption";
      throw error;
    }
  };
}

async function approveResultApproval(input: {
  cwd: string;
  result: Awaited<ReturnType<typeof runCiRepairOrchestrator>>;
  now: Date;
}): Promise<string> {
  expect(input.result.status).toBe("waiting_approval");

  if (input.result.approval === undefined) {
    throw new Error("Expected approval request");
  }

  await decideApproval({
    cwd: input.cwd,
    id: input.result.approval.id,
    decision: "approved",
    decidedBy: "local-admin",
    now: input.now
  });

  return input.result.approval.id;
}

async function allowExternalWorkerStartForTest(workspace: string): Promise<void> {
  const policyPath = join(workspace, ".runstead", "policies", "repo-maintenance.yaml");
  const raw = await readFile(policyPath, "utf8");
  const withoutApprovalRule = raw.replace(
    /\n {2}- id: require_approval_external_worker_start\n {4}when:\n {6}action_type: worker\.external\.start\n {4}decision: require_approval\n {4}risk: high\n/s,
    ""
  );

  await writeFile(
    policyPath,
    withoutApprovalRule.replace(
      "          - checkpoint.restore\n",
      "          - checkpoint.restore\n          - worker.external.start\n"
    ),
    "utf8"
  );
}

async function denyPublishSubActionForTest(
  workspace: string,
  actionType: "git.push" | "github.pr.create"
): Promise<void> {
  const policyPath = join(workspace, ".runstead", "policies", "repo-maintenance.yaml");
  const raw = await readFile(policyPath, "utf8");
  const ruleId = `deny_publish_subaction_${actionType.replace(/[^a-z0-9]+/g, "_")}`;
  const rule = [
    "  - id: " + ruleId,
    "    when:",
    `      action_type: ${actionType}`,
    "    decision: deny",
    "    risk: critical",
    ""
  ].join("\n");

  await writeFile(policyPath, raw.replace("rules:\n", `rules:\n\n${rule}`), "utf8");
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
