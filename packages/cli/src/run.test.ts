import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireManagerLock, type Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { formatRunOnceReport, runOnce, runOnceExitCode } from "./run.js";
import type { RunCiRepairOrchestratorResult } from "./ci-repair-orchestrator.js";

describe("runOnce", () => {
  it("throws before creating state in an uninitialized workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await expect(runOnce({ cwd: workspace })).rejects.toThrow(
        `Runstead is not initialized at ${join(workspace, ".runstead")}`
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns no queued task when none exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await runOnce({ cwd: workspace });

      expect(result).toEqual({
        cwd: workspace,
        ranTask: false,
        reason: "no_queued_task"
      });
      expect(formatRunOnceReport(result)).toBe(
        "Runstead run --once\nStatus: idle\nReason: no queued task"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("refuses to run while another manager holds the workspace lock", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const lock = await acquireManagerLock({
        lockPath: join(initialized.root, "manager.lock"),
        ownerId: "test-manager"
      });

      try {
        await expect(runOnce({ cwd: workspace })).rejects.toThrow(
          "Runstead manager lock is already held"
        );
      } finally {
        await lock.release();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs the next queued task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      configureTaskCommand(goal.stateDb, {
        ...task,
        input: {
          commands: [
            {
              name: "test",
              command: nodeCommand("process.exit(0)")
            }
          ]
        },
        verifiers: ["command:test"]
      });
      await allowVerifierCommand(workspace, nodeCommand("process.exit(0)"));

      const result = await runOnce({ cwd: workspace });

      expect(result).toMatchObject({
        cwd: workspace,
        ranTask: true,
        task: {
          id: task.id,
          status: "completed"
        },
        commandResults: [
          {
            verifier: "test",
            exitCode: 0,
            timedOut: false
          }
        ]
      });
      expect(formatRunOnceReport(result)).toContain(`Task: ${task.id}`);
      expect(formatRunOnceReport(result)).toContain("test: exit=0 evidence=");
      expect(runOnceExitCode(result)).toBe(0);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not route ci repair tasks through the generic runner", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-ci-repair-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const verifierTask = goal.generatedTasks[0];

      if (verifierTask === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      insertTask(goal.stateDb, {
        id: "task_ci_repair_older",
        goalId: goal.goal.id,
        domain: "repo-maintenance",
        type: "ci_repair",
        status: "queued",
        priority: "high",
        attempt: 0,
        maxAttempts: 1,
        input: {
          source: "github_actions",
          runId: "123"
        },
        verifiers: ["evidence:github_workflow_run"],
        createdAt: "2026-05-14T07:59:00.000Z",
        updatedAt: "2026-05-14T07:59:00.000Z"
      });
      configureTaskCommand(goal.stateDb, {
        ...verifierTask,
        input: {
          commands: [
            {
              name: "test",
              command: nodeCommand("process.exit(0)")
            }
          ]
        },
        verifiers: ["command:test"]
      });
      await allowVerifierCommand(workspace, nodeCommand("process.exit(0)"));

      const result = await runOnce({ cwd: workspace });

      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: verifierTask.id,
          type: "run_local_verifiers",
          status: "completed"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("routes ready ci repair tasks through the orchestrator", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-ci-ready-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task: Task = {
        id: "task_ci_repair_ready",
        goalId: goal.goal.id,
        domain: "repo-maintenance",
        type: "ci_repair",
        status: "queued",
        priority: "high",
        attempt: 0,
        maxAttempts: 1,
        input: {
          source: "github_actions",
          runId: "123",
          logEvidenceType: "github_workflow_run",
          workflowRun: {
            runId: "123",
            status: "completed",
            conclusion: "failure"
          },
          commands: [
            {
              name: "test",
              command: "pnpm test"
            }
          ]
        },
        verifiers: ["evidence:github_workflow_run", "command:test"],
        createdAt: "2026-05-14T07:59:00.000Z",
        updatedAt: "2026-05-14T07:59:00.000Z"
      };
      const calls: unknown[] = [];

      insertTask(goal.stateDb, task);

      const result = await runOnce({
        cwd: workspace,
        authToken: "ghs_token",
        ciRepairOrchestrator: (options) => {
          calls.push(options);

          return Promise.resolve(
            fakeCiRepairOrchestration(workspace, goal.stateDb, task)
          );
        }
      });

      expect(calls).toEqual([
        expect.objectContaining({
          cwd: workspace,
          runId: "123",
          worker: "codex_cli",
          verifierCommands: [{ name: "test", command: "pnpm test" }],
          authToken: "ghs_token"
        })
      ]);
      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: task.id,
          type: "ci_repair",
          status: "completed"
        },
        ciRepairResult: {
          status: "completed",
          branchName: "runstead/task_ci_repair_ready/ci-123"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks queued task types that do not have a run route", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-unsupported-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task: Task = {
        id: "task_research_scan",
        goalId: goal.goal.id,
        domain: "research-monitor",
        type: "scan_sources",
        status: "queued",
        priority: "medium",
        attempt: 0,
        maxAttempts: 1,
        input: {
          taskType: "scan_sources"
        },
        verifiers: ["source:url_recorded"],
        createdAt: "2026-05-14T07:59:00.000Z",
        updatedAt: "2026-05-14T07:59:00.000Z"
      };

      insertTask(goal.stateDb, task);

      const result = await runOnce({
        cwd: workspace,
        now: new Date("2026-05-14T08:02:00.000Z")
      });

      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: task.id,
          type: "scan_sources",
          status: "blocked",
          output: {
            reason: "unsupported_task_type",
            supportedTaskTypes: ["run_local_verifiers", "ci_repair", "manual_review"]
          }
        }
      });
      expect(formatRunOnceReport(result)).toContain("Blocked: unsupported_task_type");
      expect(runOnceExitCode(result)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("routes manual review tasks to an explicit human-evidence block", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-manual-review-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:00:00.000Z")
      });
      const task: Task = {
        id: "task_manual_review",
        goalId: goal.goal.id,
        domain: "customer-ops",
        type: "manual_review",
        status: "queued",
        priority: "medium",
        attempt: 0,
        maxAttempts: 1,
        input: {
          taskType: "manual_review",
          description: "Review the current domain state and attach evidence."
        },
        verifiers: ["manual_review:evidence_attached"],
        createdAt: "2026-05-14T07:59:00.000Z",
        updatedAt: "2026-05-14T07:59:00.000Z"
      };

      insertTask(goal.stateDb, task);

      const result = await runOnce({
        cwd: workspace,
        now: new Date("2026-05-14T08:02:00.000Z")
      });

      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: task.id,
          type: "manual_review",
          status: "blocked",
          output: {
            reason: "manual_review_required",
            summary:
              "Manual review tasks require a human evidence attachment before automation can continue.",
            verifiers: ["manual_review:evidence_attached"]
          }
        }
      });
      expect(formatRunOnceReport(result)).toContain("Blocked: manual_review_required");
      expect(runOnceExitCode(result)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("returns a non-zero exit code for a failed task", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-run-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T08:10:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      configureTaskCommand(goal.stateDb, {
        ...task,
        input: {
          commands: [
            {
              name: "test",
              command: nodeCommand("process.exit(5)")
            }
          ]
        },
        verifiers: ["command:test"]
      });
      await allowVerifierCommand(workspace, nodeCommand("process.exit(5)"));

      const result = await runOnce({ cwd: workspace });

      expect(result).toMatchObject({
        ranTask: true,
        task: {
          id: task.id,
          status: "failed"
        }
      });
      expect(runOnceExitCode(result)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

function configureTaskCommand(stateDb: string, task: Task): void {
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_run_configured`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          commands: task.input.commands
        },
        createdAt: "2026-05-14T08:01:00.000Z"
      },
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

function insertTask(stateDb: string, task: Task): void {
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_created`,
        type: "task.created",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          goalId: task.goalId,
          type: task.type
        },
        createdAt: task.createdAt
      },
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

function fakeCiRepairOrchestration(
  cwd: string,
  stateDb: string,
  task: Task
): RunCiRepairOrchestratorResult {
  const completedTask: Task = {
    ...task,
    status: "completed",
    updatedAt: "2026-05-14T08:05:00.000Z"
  };

  return {
    status: "completed",
    ciRepair: {
      status: "created",
      cwd,
      stateDb,
      task: completedTask,
      event: {
        eventId: "evt_ci_ready",
        type: "task.created",
        aggregateType: "task",
        aggregateId: task.id,
        payload: { runId: "123" },
        createdAt: task.createdAt
      },
      evidence: {
        id: "ev_ci_ready",
        type: "github_workflow_run",
        subjectType: "task",
        subjectId: task.id,
        uri: "file:///repo/.runstead/evidence/ci-ready.json",
        createdAt: task.createdAt
      },
      evidencePath: "/repo/.runstead/evidence/ci-ready.json",
      workflowRun: {
        runId: "123",
        status: "completed",
        conclusion: "failure"
      },
      log: {
        runId: "123",
        log: "",
        byteLength: 0
      },
      created: false
    },
    branchName: "runstead/task_ci_repair_ready/ci-123"
  };
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

async function allowVerifierCommand(workspace: string, command: string): Promise<void> {
  await writeFile(
    join(workspace, ".runstead", "policies", "repo-maintenance.yaml"),
    `id: policy_repo_maintenance_v1
version: 1
default_decision: require_approval
default_risk: medium

rules:
  - id: allow_test_command
    when:
      action_type: shell.exec
      command:
        matches_any:
          - '${escapeYamlSingleQuoted(`^${escapeRegex(command)}$`)}'
    decision: allow
    risk: low
`,
    "utf8"
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function escapeYamlSingleQuoted(value: string): string {
  return value.replaceAll("'", "''");
}
