import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { listTasks } from "./tasks.js";
import {
  formatWorkPackWorkflowRunPlan,
  queueWorkPackWorkflowRun,
  resolveWorkPackWorkflowRun
} from "./work-pack-run.js";

describe("work pack run surface", () => {
  it("resolves a pack workflow with capability policy and evidence contract", async () => {
    const result = await resolveWorkPackWorkflowRun({
      pack: "ai-native-startup",
      workflow: "build-mvp",
      cwd: "/tmp/runstead-mvp"
    });
    const report = formatWorkPackWorkflowRunPlan(result);

    expect(result.workPack.id).toBe("ai-native-startup");
    expect(result.workflow).toMatchObject({
      id: "build-mvp",
      kind: "goal_template"
    });
    expect(result.evidenceContract?.outputs).toEqual(
      expect.arrayContaining([
        "startup_agent_context",
        "startup_measurement_framework",
        "launch_readiness_report"
      ])
    );
    expect(report).toContain("Runstead work pack run");
    expect(report).toContain("Capability approvals: 4");
    expect(report).toContain("Completion criteria: 4");
    expect(report).toContain("runstead startup ready --cwd /tmp/runstead-mvp");
  });

  it("rejects workflows that are not declared by the pack", async () => {
    await expect(
      resolveWorkPackWorkflowRun({
        pack: "research-monitor",
        workflow: "build-mvp",
        cwd: "/tmp/research"
      })
    ).rejects.toThrow("Workflow build-mvp is not declared by pack research-monitor");
  });

  it("installs a pack and queues a goal-template workflow as real tasks", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-work-pack-queue-"));

    try {
      await initRunstead({ cwd: workspace });

      const queued = await queueWorkPackWorkflowRun({
        cwd: workspace,
        pack: "research-monitor",
        workflow: "weekly-research-digest",
        now: new Date("2026-05-30T00:00:00.000Z")
      });

      await expect(
        access(
          join(workspace, ".runstead", "domains", "research-monitor", "domain.yaml")
        )
      ).resolves.toBeUndefined();
      expect(queued.installedPack).toBe(true);
      expect(queued.goal).toMatchObject({
        domain: "research-monitor",
        title: "Weekly research digest"
      });
      expect(queued.tasks.map((task) => task.type)).toEqual([
        "discover_sources",
        "scan_sources",
        "evaluate_source_reliability",
        "summarize_findings",
        "triage_source_conflicts",
        "prepare_digest_release",
        "archive_research_memory"
      ]);
      expect(listTasks({ cwd: workspace, goalId: queued.goal.id }).tasks).toHaveLength(
        7
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("queues a task-type workflow under a synthetic goal", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-work-pack-task-type-"));

    try {
      await initRunstead({ cwd: workspace });

      const queued = await queueWorkPackWorkflowRun({
        cwd: workspace,
        pack: "repo-maintenance",
        workflow: "run_local_verifiers",
        now: new Date("2026-05-30T00:00:00.000Z")
      });

      expect(queued.installedPack).toBe(false);
      expect(queued.goal).toMatchObject({
        domain: "repo-maintenance",
        title: "Run run_local_verifiers"
      });
      expect(queued.tasks).toHaveLength(1);
      expect(queued.tasks[0]).toMatchObject({
        goalId: queued.goal.id,
        domain: "repo-maintenance",
        type: "run_local_verifiers",
        status: "queued"
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
