import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { createSkillCandidatePackage, promoteSkillPackage } from "@runstead/skills";
import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { createLocalAgentTask, LOCAL_AGENT_TASK_TYPE } from "./local-agent.js";
import {
  activateSkillPackage,
  buildTaskSkillContextPack,
  loadSkillActivationRegistry,
  recordTaskSkillActivationOutcomes
} from "./skill-activations.js";

describe("skill activations", () => {
  it("auto-rolls back active skills when a task regresses", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-skill-rollback-"));

    try {
      const initialized = await initRunstead({
        cwd: workspace,
        profile: "trusted-local"
      });
      const skillRoot = join(workspace, "skills", "rollback-test-skill");

      await createSkillCandidatePackage({
        root: skillRoot,
        name: "rollback-test-skill",
        domain: "repo-maintenance",
        description: "Rollback test skill.",
        triggers: ["failing verifier"],
        allowedTools: ["workspace.read", "workspace.write", "verifier.run"],
        deniedTools: ["secret.read", "external.write"],
        verifierCommands: ["pnpm test"],
        provenanceTasks: ["task_prior"],
        scopeRepos: [workspace]
      });
      await promoteSkillPackage({ root: skillRoot, promotedBy: "maintainer" });
      const created = await createLocalAgentTask({
        cwd: workspace,
        prompt: "Run a task with an active skill.",
        worker: "codex_direct",
        mode: "repair"
      });

      const database = openRunsteadDatabase(initialized.stateDb);

      try {
        const activation = activateSkillPackage({
          root: join(workspace, ".runstead"),
          database,
          skillRoot,
          status: "active",
          risk: "low",
          canaryPercent: 100,
          rollbackOnRegression: true,
          activatedBy: "maintainer",
          scopeRepos: [workspace],
          taskTypes: [LOCAL_AGENT_TASK_TYPE]
        });

        buildTaskSkillContextPack({
          cwd: workspace,
          root: join(workspace, ".runstead"),
          database,
          task: created.task
        });
        const rolledBack = recordTaskSkillActivationOutcomes({
          root: join(workspace, ".runstead"),
          database,
          task: {
            ...created.task,
            status: "failed"
          }
        });
        const registry = loadSkillActivationRegistry(join(workspace, ".runstead"));
        const event = database
          .prepare("SELECT type FROM events WHERE type = 'skill.activation_disabled'")
          .get() as { type: string };

        expect(rolledBack.map((record) => record.id)).toEqual([activation.id]);
        expect(registry.activations[0]).toMatchObject({
          id: activation.id,
          status: "disabled",
          disabledBy: "runstead:auto-rollback",
          disabledReason: `task ${created.task.id} ended with failed`
        });
        expect(event.type).toBe("skill.activation_disabled");
      } finally {
        database.close();
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
