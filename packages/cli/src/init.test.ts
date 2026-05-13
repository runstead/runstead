import { access, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";

describe("initRunstead", () => {
  it("creates the local .runstead scaffold", async () => {
    const workspace = join(tmpdir(), `runstead-cli-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const result = await initRunstead({ cwd: workspace });
      const config = await readFile(join(result.root, "config.yaml"), "utf8");
      const goalTemplate = await readFile(
        join(
          result.root,
          "domains",
          "repo-maintenance",
          "goal-templates",
          "keep-ci-green.yaml"
        ),
        "utf8"
      );
      const domainPolicy = await readFile(
        join(
          result.root,
          "domains",
          "repo-maintenance",
          "policies",
          "repo-maintenance.yaml"
        ),
        "utf8"
      );
      const rbacPolicy = await readFile(join(result.root, "rbac.yaml"), "utf8");
      const teamPolicy = await readFile(join(result.root, "team-policy.yaml"), "utf8");
      const database = await stat(result.stateDb);
      const evidenceFiles = await readdir(join(result.root, "evidence"));

      expect(config).toContain("domain: repo-maintenance");
      expect(config).toContain("events:\n  source: sqlite");
      expect(goalTemplate).toContain("id: keep-ci-green");
      expect(domainPolicy).toContain("id: policy_repo_maintenance_v1");
      expect(domainPolicy).toContain("default_decision: require_approval");
      expect(rbacPolicy).toContain("local-admin");
      expect(teamPolicy).toContain("team_policy_repo_maintenance_v1");
      expect(database.isFile()).toBe(true);
      expect(evidenceFiles).toEqual([
        expect.stringMatching(/^repo-inspection-ev_[a-f0-9]+\.json$/)
      ]);
      await expect(access(join(result.root, "events.jsonl"))).rejects.toThrow();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("can create the default repo-maintenance goal during init", async () => {
    const workspace = join(tmpdir(), `runstead-cli-goal-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const result = await initRunstead({
        cwd: workspace,
        createDefaultGoal: true
      });

      const generatedTask = result.generatedTasks[0];

      if (generatedTask === undefined || result.defaultGoal === undefined) {
        throw new Error("Expected init to create a default goal and task");
      }

      expect(result.defaultGoal).toMatchObject({
        domain: "repo-maintenance",
        title: "Keep repository CI green",
        status: "active"
      });
      expect(result.generatedTasks).toHaveLength(1);
      expect(generatedTask).toMatchObject({
        goalId: result.defaultGoal.id,
        type: "run_local_verifiers",
        status: "queued"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
