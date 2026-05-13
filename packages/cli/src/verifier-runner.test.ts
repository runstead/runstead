import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { showTask } from "./tasks.js";
import { runTaskVerifiers } from "./verifier-runner.js";

describe("runTaskVerifiers", () => {
  it("marks a task completed when all verifier commands pass", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-run-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(0)");

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:00:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const storedTask = database
          .prepare("SELECT status, attempt, output_json FROM tasks WHERE id = ?")
          .get(task.id) as {
          status: string;
          attempt: number;
          output_json: string;
        };
        const evidenceCount = database
          .prepare("SELECT COUNT(*) AS count FROM evidence WHERE subject_id = ?")
          .get(task.id) as { count: number };

        expect(result.task.status).toBe("completed");
        expect(result.commandResults).toMatchObject([
          {
            verifier: "test",
            exitCode: 0,
            timedOut: false
          }
        ]);
        expect(storedTask.status).toBe("completed");
        expect(storedTask.attempt).toBe(1);
        expect(JSON.parse(storedTask.output_json)).toMatchObject({
          summary: "All verifier commands passed"
        });
        expect(evidenceCount.count).toBe(1);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("marks a task failed when a verifier command fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-run-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(4)");

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:30:00.000Z")
      });

      expect(result.task.status).toBe("failed");
      expect(result.commandResults).toMatchObject([
        {
          verifier: "test",
          exitCode: 4,
          timedOut: false
        }
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("runs verifiers against a legacy .team workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-team-"));

    try {
      const task = await createTaskWithCommand(workspace, "process.exit(0)");

      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:45:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".team", "state.db"));

      try {
        const storedTask = database
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(task.id) as { status: string };
        const evidence = database
          .prepare("SELECT uri FROM evidence WHERE subject_id = ?")
          .get(task.id) as { uri: string };

        expect(result.task.status).toBe("completed");
        expect(storedTask.status).toBe("completed");
        expect(evidence.uri).toContain("/.team/evidence/");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks denied verifier commands before execution", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-policy-"));

    try {
      const task = await createTaskWithRawCommand(
        workspace,
        "pnpm test && rm -rf .runstead"
      );

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:50:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const policyDecision = database
          .prepare("SELECT decision, rule_id FROM policy_decisions")
          .get() as { decision: string; rule_id: string };
        const toolCall = database
          .prepare("SELECT status FROM tool_calls")
          .get() as { status: string };

        expect(result.task.status).toBe("blocked");
        expect(result.commandResults).toMatchObject([
          {
            verifier: "test",
            exitCode: null,
            timedOut: false
          }
        ]);
        expect(policyDecision).toEqual({
          decision: "deny",
          rule_id: "deny_destructive_shell"
        });
        expect(toolCall.status).toBe("denied");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requests approval for unknown verifier commands without execution", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-approval-"));

    try {
      const task = await createTaskWithRawCommand(
        workspace,
        nodeCommand("process.exit(0)")
      );

      const result = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:55:00.000Z")
      });
      const database = openRunsteadDatabase(join(workspace, ".runstead", "state.db"));

      try {
        const approval = database
          .prepare("SELECT status, action_id FROM approvals")
          .get() as { status: string; action_id: string };
        const toolCall = database
          .prepare("SELECT status FROM tool_calls")
          .get() as { status: string };

        expect(result.task.status).toBe("waiting_approval");
        const commandResult = result.commandResults[0];

        if (commandResult === undefined) {
          throw new Error("Expected policy-blocked command result");
        }

        expect(commandResult).toMatchObject({
          verifier: "test",
          exitCode: null,
          approvalId: expect.stringMatching(/^appr_/)
        });
        expect(approval).toMatchObject({
          status: "pending",
          action_id: expect.stringMatching(/^act_/)
        });
        expect(toolCall.status).toBe("approval_required");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses approved verifier approvals once on retry", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-verifier-approved-"));

    try {
      const task = await createTaskWithRawCommand(
        workspace,
        nodeCommand("process.exit(0)")
      );
      const waiting = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:56:00.000Z")
      });
      const approvalId = waiting.commandResults[0]?.approvalId;

      if (approvalId === undefined) {
        throw new Error("Expected approval id");
      }

      decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        decidedBy: "alice",
        now: new Date("2026-05-14T06:57:00.000Z")
      });
      expect(showTask({ cwd: workspace, id: task.id }).task.status).toBe("queued");

      const completed = await runTaskVerifiers({
        cwd: workspace,
        taskId: task.id,
        now: new Date("2026-05-14T06:58:00.000Z")
      });

      expect(completed.task.status).toBe("completed");
      expect(completed.commandResults[0]).toMatchObject({
        exitCode: 0,
        approvalId
      });
      expect(showApproval({ cwd: workspace, id: approvalId }).approval.status).toBe(
        "expired"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function createTaskWithCommand(workspace: string, script: string): Promise<Task> {
  await initRunstead({ cwd: workspace });
  const command = nodeCommand(script);
  await allowVerifierCommand(workspace, command);

  const goal = await createGoal({
    cwd: workspace,
    domain: "repo-maintenance",
    now: new Date("2026-05-14T05:30:00.000Z")
  });
  const task = goal.generatedTasks[0];

  if (task === undefined) {
    throw new Error("Expected createGoal to generate run_local_verifiers task");
  }

  const verifierTask: Task = {
    ...task,
    input: {
      commands: [
        {
          name: "test",
          command
        }
      ]
    },
    verifiers: ["command:test"]
  };
  const database = openRunsteadDatabase(goal.stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_configured`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          commands: verifierTask.input.commands
        },
        createdAt: "2026-05-14T05:31:00.000Z"
      },
      projection: {
        type: "task",
        value: verifierTask
      }
    });
  } finally {
    database.close();
  }

  return verifierTask;
}

async function createTaskWithRawCommand(
  workspace: string,
  command: string
): Promise<Task> {
  await initRunstead({ cwd: workspace });

  const goal = await createGoal({
    cwd: workspace,
    domain: "repo-maintenance",
    now: new Date("2026-05-14T05:30:00.000Z")
  });
  const task = goal.generatedTasks[0];

  if (task === undefined) {
    throw new Error("Expected createGoal to generate run_local_verifiers task");
  }

  const verifierTask: Task = {
    ...task,
    input: {
      commands: [
        {
          name: "test",
          command
        }
      ]
    },
    verifiers: ["command:test"]
  };
  const database = openRunsteadDatabase(goal.stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: `evt_${task.id}_configured_raw`,
        type: "task.updated",
        aggregateType: "task",
        aggregateId: task.id,
        payload: {
          commands: verifierTask.input.commands
        },
        createdAt: "2026-05-14T05:31:00.000Z"
      },
      projection: {
        type: "task",
        value: verifierTask
      }
    });
  } finally {
    database.close();
  }

  return verifierTask;
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
