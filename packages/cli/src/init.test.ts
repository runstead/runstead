import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";

describe("initRunstead", () => {
  it("creates the local .runstead scaffold", async () => {
    const workspace = join(tmpdir(), `runstead-cli-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const result = await initRunstead({ cwd: workspace });
      const config = await readFile(join(result.root, "config.yaml"), "utf8");
      const runsteadGitignore = await readFile(
        join(result.root, ".gitignore"),
        "utf8"
      );
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
      const rootPolicy = await readFile(
        join(result.root, "policies", "repo-maintenance.yaml"),
        "utf8"
      );
      const rbacPolicy = await readFile(join(result.root, "rbac.yaml"), "utf8");
      const teamPolicy = await readFile(join(result.root, "team-policy.yaml"), "utf8");
      const domainManifest = JSON.parse(
        await readFile(
          join(result.root, "domains", "repo-maintenance", "runstead-manifest.json"),
          "utf8"
        )
      ) as { domain: { id: string }; fixtures: string[]; evals: string[] };
      const database = await stat(result.stateDb);
      const evidenceFiles = await readdir(join(result.root, "evidence"));
      const daemonDir = await stat(join(result.root, "daemon"));

      expect(config).toContain("domain: repo-maintenance");
      expect(config).toContain("events:\n  source: sqlite");
      expect(runsteadGitignore).toContain("state.db");
      expect(runsteadGitignore).toContain("evidence/");
      expect(goalTemplate).toContain("id: keep-ci-green");
      expect(result.profile).toBe("default");
      expect(rootPolicy).toContain("id: require_approval_external_worker_start");
      expect(rootPolicy).not.toContain("allow_trusted_local_external_worker_start");
      expect(domainPolicy).toContain("id: policy_repo_maintenance_v1");
      expect(domainPolicy).toContain("default_decision: require_approval");
      expect(domainManifest).toMatchObject({
        domain: {
          id: "repo-maintenance"
        },
        fixtures: ["js-test-failure"],
        evals: ["js-test-failure-smoke"]
      });
      expect(rbacPolicy).toContain("local-admin");
      expect(teamPolicy).toContain("team_policy_repo_maintenance_v1");
      expect(database.isFile()).toBe(true);
      expect(daemonDir.isDirectory()).toBe(true);
      expect(evidenceFiles).toEqual([
        expect.stringMatching(/^repo-inspection-ev_[a-f0-9]+\.json$/)
      ]);
      await expect(access(join(result.root, "events.jsonl"))).rejects.toThrow();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("installs local git exclusions for runtime artifacts", async () => {
    const workspace = join(tmpdir(), `runstead-cli-git-exclude-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(join(workspace, ".git", "info"), { recursive: true });
      await writeFile(join(workspace, ".git", "info", "exclude"), "# local\n", "utf8");

      await initRunstead({ cwd: workspace });

      const exclude = await readFile(
        join(workspace, ".git", "info", "exclude"),
        "utf8"
      );

      expect(exclude).toContain(".runstead/state.db");
      expect(exclude).toContain(".runstead/evidence/");
      expect(exclude).toContain("# local");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("can generate a trusted-local policy profile", async () => {
    const workspace = join(tmpdir(), `runstead-cli-trusted-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      const result = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      const policyPath = join(result.root, "policies", "repo-maintenance.yaml");
      const policyText = await readFile(policyPath, "utf8");
      const policy = await loadPolicyProfileFromFile(policyPath);

      const trustedWorker = evaluatePolicy({
        policy,
        action: {
          actionId: "act_worker_codex",
          actionType: "worker.external.start",
          resource: {
            type: "process",
            id: "codex_cli"
          },
          context: {
            cwd: workspace
          }
        }
      });
      const unknownWorker = evaluatePolicy({
        policy,
        action: {
          actionId: "act_worker_unknown",
          actionType: "worker.external.start",
          resource: {
            type: "process",
            id: "unknown_worker"
          },
          context: {
            cwd: workspace
          }
        }
      });
      const dependencyCommit = evaluatePolicy({
        policy,
        action: {
          actionId: "act_commit_dependency",
          actionType: "git.commit",
          context: {
            cwd: workspace,
            filesTouched: ["src/index.ts", "pnpm-lock.yaml"]
          }
        }
      });
      const publish = evaluatePolicy({
        policy,
        action: {
          actionId: "act_publish",
          actionType: "github.pr.create",
          context: {
            cwd: workspace,
            sideEffects: ["github_pr_create"]
          }
        }
      });
      const protectedPath = evaluatePolicy({
        policy,
        action: {
          actionId: "act_secret",
          actionType: "git.commit",
          context: {
            cwd: workspace,
            filesTouched: [".env"]
          }
        }
      });

      expect(result.profile).toBe("trusted-local");
      expect(policyText).toContain("resource_id:");
      expect(policyText).toContain("allow_trusted_local_external_worker_start");
      expect(trustedWorker).toMatchObject({
        decision: "allow",
        ruleId: "allow_trusted_local_external_worker_start",
        matchedResourceId: "codex_cli"
      });
      expect(unknownWorker).toMatchObject({
        decision: "require_approval",
        risk: "medium"
      });
      expect(dependencyCommit).toMatchObject({
        decision: "require_approval",
        risk: "high",
        ruleId: "require_approval_dependency_file_commit"
      });
      expect(publish).toMatchObject({
        decision: "require_approval",
        risk: "high",
        ruleId: "require_approval_external_write"
      });
      expect(protectedPath).toMatchObject({
        decision: "deny",
        risk: "critical",
        ruleId: "deny_secret_files"
      });
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
