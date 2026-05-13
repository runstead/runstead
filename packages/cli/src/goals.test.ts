import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { createGoal, listGoals, showGoal } from "./goals.js";
import { initRunstead } from "./init.js";
import { registerRepository } from "./repositories.js";

describe("createGoal", () => {
  it("creates a repo-maintenance goal from the installed domain pack", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-goal-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@11.1.1",
          scripts: {
            test: "vitest run",
            lint: "eslint src"
          }
        }),
        "utf8"
      );
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
        const task = database
          .prepare(
            `
            SELECT id, goal_id, type, status, input_json, verifiers_json
            FROM tasks
            WHERE goal_id = ?
          `
          )
          .get(result.goal.id) as {
          id: string;
          goal_id: string;
          type: string;
          status: string;
          input_json: string;
          verifiers_json: string;
        };
        const generatedTask = result.generatedTasks[0];

        if (generatedTask === undefined) {
          throw new Error("Expected createGoal to generate run_local_verifiers task");
        }

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
        expect(task).toMatchObject({
          id: generatedTask.id,
          goal_id: result.goal.id,
          type: "run_local_verifiers",
          status: "queued"
        });
        expect(JSON.parse(task.input_json)).toEqual({
          repositoryPath: workspace,
          commands: [
            {
              name: "test",
              command: "pnpm test",
              rawScript: "vitest run"
            },
            {
              name: "lint",
              command: "pnpm run lint",
              rawScript: "eslint src"
            }
          ]
        });
        expect(JSON.parse(task.verifiers_json)).toEqual([
          "command:test",
          "command:lint"
        ]);
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("creates a goal against a registered repository", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-goal-repo-"));
    const repositoryPath = join(workspace, "service");

    try {
      await mkdir(repositoryPath);
      await writeFile(
        join(repositoryPath, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@11.1.1",
          scripts: {
            test: "vitest run"
          }
        }),
        "utf8"
      );
      await initRunstead({ cwd: workspace });
      const repository = await registerRepository({
        cwd: workspace,
        path: "service",
        alias: "service-api",
        now: new Date("2026-05-14T01:10:00.000Z")
      });

      const result = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        repository: "service-api",
        now: new Date("2026-05-14T01:11:00.000Z")
      });

      expect(result.goal.scope).toMatchObject({
        repositoryId: repository.repository.id,
        repositoryAlias: "service-api",
        repositoryPath: repository.repository.localPath,
        templateId: "keep-ci-green"
      });
      expect(result.generatedTasks[0]?.input).toEqual({
        repositoryPath: repository.repository.localPath,
        commands: [
          {
            name: "test",
            command: "pnpm test",
            rawScript: "vitest run"
          }
        ]
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("lists and shows persisted goals", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-goal-"));

    try {
      await initRunstead({ cwd: workspace });

      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        title: "Custom CI health goal",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      const listed = listGoals({ cwd: workspace });
      const shown = showGoal({ cwd: workspace, id: created.goal.id });

      expect(listed.goals).toEqual([created.goal]);
      expect(shown.goal).toEqual(created.goal);
      expect(shown.stateDb).toBe(created.stateDb);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("creates and reads goals from a legacy .team workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-goal-team-"));

    try {
      await initRunstead({ cwd: workspace });
      await cp(join(workspace, ".runstead"), join(workspace, ".team"), {
        recursive: true
      });
      await rm(join(workspace, ".runstead"), { force: true, recursive: true });

      const created = await createGoal({
        cwd: workspace,
        domain: "repo-maintenance",
        title: "Legacy team goal",
        now: new Date("2026-05-14T02:10:00.000Z")
      });
      const listed = listGoals({ cwd: workspace });
      const shown = showGoal({ cwd: workspace, id: created.goal.id });

      expect(created.stateDb).toBe(join(workspace, ".team", "state.db"));
      expect(listed.stateDb).toBe(join(workspace, ".team", "state.db"));
      expect(listed.goals).toEqual([created.goal]);
      expect(shown.goal).toEqual(created.goal);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
