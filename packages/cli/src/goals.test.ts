import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal } from "./goals.js";
import { initRunstead } from "./init.js";

describe("createGoal", () => {
  it("creates a repo-maintenance goal from the installed domain pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-goal-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        now: new Date("2026-05-14T01:00:00.000Z")
      });
      const database = openRunsteadDatabase(result.stateDb);

      try {
        const goal = database
          .prepare(
            `
            SELECT id, domain, title, status, priority, scope_json, policy_ref,
                   created_at, updated_at
            FROM goals
            WHERE id = ?
          `
          )
          .get(result.goal.id) as {
          id: string;
          domain: string;
          title: string;
          status: string;
          priority: string;
          scope_json: string;
          policy_ref: string;
          created_at: string;
          updated_at: string;
        };
        const event = database
          .prepare(
            `
            SELECT type, aggregate_type, aggregate_id, payload_json, created_at
            FROM events
            WHERE aggregate_id = ?
          `
          )
          .get(result.goal.id) as {
          type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload_json: string;
          created_at: string;
        };

        expect(goal).toMatchObject({
          id: result.goal.id,
          domain: "repo-maintenance",
          title: "Keep repository CI green",
          status: "active",
          priority: "medium",
          policy_ref: "policies/repo-maintenance.yaml",
          created_at: "2026-05-14T01:00:00.000Z",
          updated_at: "2026-05-14T01:00:00.000Z"
        });
        expect(JSON.parse(goal.scope_json)).toEqual({
          repositoryPath: workspace,
          templateId: "keep-ci-green",
          recurringTasks: ["run_local_verifiers"],
          acceptanceContracts: ["tests_pass", "lint_pass", "diff_scope_clean"]
        });
        expect(event).toMatchObject({
          type: "goal.created",
          aggregate_type: "goal",
          aggregate_id: result.goal.id,
          created_at: "2026-05-14T01:00:00.000Z"
        });
        expect(JSON.parse(event.payload_json)).toMatchObject({
          domain: "repo-maintenance",
          title: "Keep repository CI green",
          templateId: "keep-ci-green",
          repositoryPath: workspace
        });
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
