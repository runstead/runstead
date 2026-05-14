import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import {
  finishToolCall,
  finishWorkerRun,
  startToolCall,
  startWorkerRun
} from "./runtime-audit.js";

describe("runtime audit", () => {
  it("records worker run and tool call projections with events", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-runtime-audit-"));

    try {
      await initRunstead({ cwd: workspace });
      const goal = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T09:00:00.000Z")
      });
      const task = goal.generatedTasks[0];

      if (task === undefined) {
        throw new Error("Expected createGoal to generate run_local_verifiers task");
      }

      const database = openRunsteadDatabase(goal.stateDb);

      try {
        const workerRun = startWorkerRun({
          database,
          task,
          workerType: "shell_verifier",
          enforcementLevel: "policy_enforced",
          now: new Date("2026-05-14T09:01:00.000Z")
        });
        const toolCall = startToolCall({
          database,
          workerRun,
          task,
          action: {
            actionId: "act_test",
            actionType: "shell.exec",
            context: {
              command: "pnpm test"
            }
          },
          now: new Date("2026-05-14T09:01:01.000Z")
        });

        appendEventAndProject(database, {
          event: {
            eventId: "evt_runtime_policy_decision",
            type: "policy.decision_recorded",
            aggregateType: "policy_decision",
            aggregateId: "poldec_test",
            payload: {
              actionId: "act_test",
              decision: "allow"
            },
            createdAt: "2026-05-14T09:01:01.500Z"
          },
          projection: {
            type: "policyDecision",
            value: {
              id: "poldec_test",
              actionId: "act_test",
              policyId: "policy_repo_maintenance_v1",
              decision: "allow",
              risk: "low",
              ruleId: "allow_verifier_commands",
              reason: "Matched policy rule allow_verifier_commands",
              obligations: [],
              action: {
                actionId: "act_test",
                actionType: "shell.exec"
              },
              result: {
                decision: "allow",
                risk: "low"
              },
              createdAt: "2026-05-14T09:01:01.500Z"
            }
          }
        });
        finishToolCall({
          database,
          toolCall,
          status: "completed",
          policyDecisionId: "poldec_test",
          output: {
            exitCode: 0
          },
          now: new Date("2026-05-14T09:01:02.000Z")
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "completed",
          output: {
            summary: "Verifier passed"
          },
          now: new Date("2026-05-14T09:01:03.000Z")
        });

        const storedWorkerRun = database
          .prepare(
            `
            SELECT status, worker_type, enforcement_level, output_json
            FROM worker_runs
            WHERE id = ?
          `
          )
          .get(workerRun.id) as {
          status: string;
          worker_type: string;
          enforcement_level: string;
          output_json: string;
        };
        const storedToolCall = database
          .prepare(
            `
            SELECT status, policy_decision_id, output_json
            FROM tool_calls
            WHERE id = ?
          `
          )
          .get(toolCall.id) as {
          status: string;
          policy_decision_id: string;
          output_json: string;
        };
        const eventTypes = (
          database
            .prepare(
              `
              SELECT type
              FROM events
              WHERE aggregate_id IN (?, ?)
              ORDER BY id ASC
            `
            )
            .all(workerRun.id, toolCall.id) as { type: string }[]
        ).map((row) => row.type);
        const requestedPayload = database
          .prepare(
            `
            SELECT payload_json
            FROM events
            WHERE type = 'tool_call.requested'
              AND aggregate_id = ?
          `
          )
          .get(toolCall.id) as { payload_json: string };

        expect(storedWorkerRun).toEqual({
          status: "completed",
          worker_type: "shell_verifier",
          enforcement_level: "policy_enforced",
          output_json: JSON.stringify({ summary: "Verifier passed" })
        });
        expect(storedToolCall).toEqual({
          status: "completed",
          policy_decision_id: "poldec_test",
          output_json: JSON.stringify({ exitCode: 0 })
        });
        expect(eventTypes).toEqual([
          "worker_run.started",
          "tool_call.requested",
          "tool_call.completed",
          "worker_run.completed"
        ]);
        expect(JSON.parse(requestedPayload.payload_json)).toMatchObject({
          toolCallId: toolCall.id,
          workerRunId: workerRun.id,
          taskId: task.id,
          actionId: "act_test",
          actionType: "shell.exec"
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
