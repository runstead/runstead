import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { decideApproval, showApproval } from "./approvals.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError
} from "./governed-action.js";
import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { fingerprintPolicyProfile } from "./policy.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { startWorkerRun } from "./runtime-audit.js";

describe("runGovernedToolAction", () => {
  it("records policy and tool call audit for allowed actions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-governed-action-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const task = await firstGeneratedTask(workspace);
      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const policy = await loadPolicyProfileFromFile(
          join(initialized.root, "policies", "repo-maintenance.yaml")
        );
        const workerRun = startWorkerRun({
          database,
          task,
          workerType: "test_worker",
          enforcementLevel: "policy_enforced",
          now: new Date("2026-05-14T12:00:00.000Z")
        });
        const result = await runGovernedToolAction({
          cwd: workspace,
          stateDb: initialized.stateDb,
          database,
          policy,
          task,
          workerRun,
          action: {
            actionId: "act_git_diff",
            actionType: "git.diff",
            resource: {
              type: "repository",
              path: workspace
            }
          },
          requestedBy: "test",
          now: new Date("2026-05-14T12:00:01.000Z"),
          run: () =>
            Promise.resolve({
              value: "ok",
              output: {
                changedFiles: []
              }
            })
        });
        const toolCall = database
          .prepare("SELECT status, policy_decision_id FROM tool_calls WHERE id = ?")
          .get(result.toolCall.id) as {
          status: string;
          policy_decision_id: string;
        };
        const policyDecision = database
          .prepare(
            "SELECT decision, rule_id, result_json FROM policy_decisions WHERE id = ?"
          )
          .get(result.policyDecision.id) as {
          decision: string;
          rule_id: string;
          result_json: string;
        };

        expect(result.value).toBe("ok");
        expect(toolCall).toMatchObject({
          status: "completed",
          policy_decision_id: result.policyDecision.id
        });
        expect(policyDecision).toMatchObject({
          decision: "allow",
          rule_id: "allow_read_workspace"
        });
        expect(JSON.parse(policyDecision.result_json)).toMatchObject({
          policyFingerprint: fingerprintPolicyProfile(policy)
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("requests approval once and consumes the approved grant on retry", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-governed-approval-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const task = await firstGeneratedTask(workspace);
      const policy = await loadPolicyProfileFromFile(
        join(initialized.root, "policies", "repo-maintenance.yaml")
      );
      const action = {
        actionId: "act_pr_task_1",
        actionType: "github.pr.create",
        resource: {
          type: "pull_request",
          id: "main...runstead/task-1"
        }
      };
      let approvalId: string | undefined;

      {
        const database = openRunsteadDatabase(initialized.stateDb);

        try {
          const workerRun = startWorkerRun({
            database,
            task,
            workerType: "test_worker",
            enforcementLevel: "policy_enforced",
            now: new Date("2026-05-14T12:05:00.000Z")
          });

          await expect(
            runGovernedToolAction({
              cwd: workspace,
              stateDb: initialized.stateDb,
              database,
              policy,
              task,
              workerRun,
              action,
              requestedBy: "test",
              now: new Date("2026-05-14T12:05:01.000Z"),
              run: () => Promise.resolve({ value: "created" })
            })
          ).rejects.toBeInstanceOf(ToolActionApprovalRequiredError);
          const approval = database
            .prepare("SELECT id, status FROM approvals WHERE action_id = ?")
            .get(action.actionId) as { id: string; status: string };

          expect(approval.status).toBe("pending");
          approvalId = approval.id;
        } finally {
          database.close();
        }
      }

      if (approvalId === undefined) {
        throw new Error("Expected approval id");
      }

      await decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:06:00.000Z")
      });

      {
        const database = openRunsteadDatabase(initialized.stateDb);

        try {
          const workerRun = startWorkerRun({
            database,
            task,
            workerType: "test_worker",
            enforcementLevel: "policy_enforced",
            now: new Date("2026-05-14T12:07:00.000Z")
          });
          const result = await runGovernedToolAction({
            cwd: workspace,
            stateDb: initialized.stateDb,
            database,
            policy,
            task,
            workerRun,
            action,
            requestedBy: "test",
            now: new Date("2026-05-14T12:07:01.000Z"),
            run: () =>
              Promise.resolve({
                value: "created",
                output: {
                  url: "https://github.example/pr/1"
                }
              })
          });

          expect(result.value).toBe("created");
          expect(result.approval?.id).toBe(approvalId);
        } finally {
          database.close();
        }
      }

      expect(showApproval({ cwd: workspace, id: approvalId }).approval.status).toBe(
        "expired"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("consumes approved grants before running approved actions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-governed-failure-"));

    try {
      const initialized = await initRunstead({ cwd: workspace });
      const task = await firstGeneratedTask(workspace);
      const policy = await loadPolicyProfileFromFile(
        join(initialized.root, "policies", "repo-maintenance.yaml")
      );
      const action = {
        actionId: "act_pr_task_failure",
        actionType: "github.pr.create",
        resource: {
          type: "pull_request",
          id: "main...runstead/task-failure"
        }
      };
      let approvalId: string | undefined;

      {
        const database = openRunsteadDatabase(initialized.stateDb);

        try {
          const workerRun = startWorkerRun({
            database,
            task,
            workerType: "test_worker",
            enforcementLevel: "policy_enforced",
            now: new Date("2026-05-14T12:10:00.000Z")
          });

          await expect(
            runGovernedToolAction({
              cwd: workspace,
              stateDb: initialized.stateDb,
              database,
              policy,
              task,
              workerRun,
              action,
              requestedBy: "test",
              now: new Date("2026-05-14T12:10:01.000Z"),
              run: () => Promise.resolve({ value: "created" })
            })
          ).rejects.toBeInstanceOf(ToolActionApprovalRequiredError);
          const approval = database
            .prepare("SELECT id FROM approvals WHERE action_id = ?")
            .get(action.actionId) as { id: string };

          approvalId = approval.id;
        } finally {
          database.close();
        }
      }

      if (approvalId === undefined) {
        throw new Error("Expected approval id");
      }

      await decideApproval({
        cwd: workspace,
        id: approvalId,
        decision: "approved",
        decidedBy: "local-admin",
        now: new Date("2026-05-14T12:11:00.000Z")
      });

      {
        const database = openRunsteadDatabase(initialized.stateDb);

        try {
          const workerRun = startWorkerRun({
            database,
            task,
            workerType: "test_worker",
            enforcementLevel: "policy_enforced",
            now: new Date("2026-05-14T12:12:00.000Z")
          });

          await expect(
            runGovernedToolAction({
              cwd: workspace,
              stateDb: initialized.stateDb,
              database,
              policy,
              task,
              workerRun,
              action,
              requestedBy: "test",
              now: new Date("2026-05-14T12:12:01.000Z"),
              run: () => Promise.reject(new Error("network failed"))
            })
          ).rejects.toThrow("network failed");

          const failedToolCall = database
            .prepare(
              "SELECT status, output_json FROM tool_calls WHERE action_type = ? ORDER BY started_at DESC, id DESC LIMIT 1"
            )
            .get(action.actionType) as { status: string; output_json: string };
          const output = JSON.parse(failedToolCall.output_json) as {
            approvalId?: string;
            approvalGrant?: string;
            error?: string;
          };

          expect(failedToolCall.status).toBe("failed");
          expect(output).toMatchObject({
            approvalId,
            approvalGrant: "used",
            error: "network failed"
          });
        } finally {
          database.close();
        }
      }

      expect(showApproval({ cwd: workspace, id: approvalId }).approval.status).toBe(
        "expired"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function firstGeneratedTask(workspace: string) {
  const goal = await createGoal({
    cwd: workspace,
    domain: "repo-maintenance",
    now: new Date("2026-05-14T11:59:00.000Z")
  });
  const task = goal.generatedTasks[0];

  if (task === undefined) {
    throw new Error("Expected generated task");
  }

  return task;
}
