import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import { listTasks } from "./tasks.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";
import {
  executedWorkPackWorkflowRunExitCode,
  executeWorkPackWorkflowRun,
  formatExecutedWorkPackWorkflowRun,
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

  it("executes queued task-type workflows through the workflow executor", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-work-pack-execute-"));

    try {
      await initRunstead({ cwd: workspace });

      const executed = await executeWorkPackWorkflowRun({
        cwd: workspace,
        pack: "repo-maintenance",
        workflow: "repo_inspect",
        now: new Date("2026-05-30T00:00:00.000Z")
      });
      const report = formatExecutedWorkPackWorkflowRun(executed);

      expect(executed).toMatchObject({
        status: "completed",
        executedTaskCount: 1,
        queued: {
          goal: {
            domain: "repo-maintenance",
            title: "Run repo_inspect"
          }
        },
        taskResults: [
          {
            ranTask: true,
            task: {
              type: "repo_inspect",
              status: "completed"
            }
          }
        ]
      });
      expect(report).toContain("Status: completed");
      expect(report).toContain("Tasks: 1/1");
      expect(report).toContain("- repo_inspect");
      expect(executedWorkPackWorkflowRunExitCode(executed)).toBe(0);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps completed workflows incomplete when evidence contracts are missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-work-pack-contract-"));

    try {
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({
          scripts: {
            test: "node -e \"process.exit(0)\"",
            lint: "node -e \"process.exit(0)\""
          }
        })}\n`,
        "utf8"
      );
      await initRunstead({ cwd: workspace });

      const executed = await executeWorkPackWorkflowRun({
        cwd: workspace,
        pack: "repo-maintenance",
        workflow: "keep-ci-green",
        now: new Date("2100-05-30T00:00:00.000Z")
      });
      const report = formatExecutedWorkPackWorkflowRun(executed);
      const outputVerdict = (id: string): boolean | undefined =>
        executed.evidenceVerdict.outputs.find((item) => item.id === id)?.satisfied;
      const criterionVerdict = (id: string): boolean | undefined =>
        executed.evidenceVerdict.completionCriteria.find((item) => item.id === id)
          ?.satisfied;

      expect(executed.status).toBe("completed");
      expect(executed.evidenceVerdict.status).toBe("incomplete");
      expect(outputVerdict("command_output")).toBe(true);
      expect(outputVerdict("repo_readiness")).toBe(false);
      expect(criterionVerdict("verifiers_pass_or_blockers_recorded")).toBe(true);
      expect(criterionVerdict("protected_paths_untouched")).toBe(false);
      expect(report).toContain("Evidence contract: incomplete");
      expect(report).toContain("Missing outputs:");
      expect(report).toContain("repo_readiness");
      expect(executedWorkPackWorkflowRunExitCode(executed)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("executes startup internal workflow tasks by exact workflow order", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-work-pack-startup-"));
    const workerPrompts: string[] = [];
    const workerRunner: WorkerProcessRunner = (_command, args) => {
      workerPrompts.push(args.join("\n"));

      return Promise.resolve({
        stdout: JSON.stringify({
          summary: "generated startup context",
          files_changed: [],
          commands_run: [],
          risks: [],
          needs_approval: false,
          approval_reason: null
        }),
        stderr: "",
        exitCode: 0
      });
    };

    try {
      await initRunstead({ cwd: workspace });

      const executed = await executeWorkPackWorkflowRun({
        cwd: workspace,
        pack: "ai-native-startup",
        workflow: "build-mvp",
        maxTasks: 1,
        workerRunner,
        now: new Date("2026-05-30T00:00:00.000Z")
      });
      const report = formatExecutedWorkPackWorkflowRun(executed);

      expect(executed.status).toBe("waiting_approval");
      expect(executed.evidenceVerdict.status).toBe("incomplete");
      expect(executed.executedTaskCount).toBe(1);
      expect(executed.taskResults[0]).toMatchObject({
        ranTask: true,
        task: {
          type: "generate_agent_context",
          status: "waiting_approval"
        }
      });
      expect(executed.queued.tasks.map((task) => task.type)).toEqual([
        "generate_agent_context",
        "define_measurement_framework",
        "inspect_repo_readiness",
        "run_mvp_verifiers"
      ]);
      expect(workerPrompts).toEqual([]);
      expect(report).toContain("Status: waiting_approval");
      expect(report).toContain("Evidence contract: incomplete");
      expect(report).toContain("Tasks: 1/4");
      expect(report).toContain("- generate_agent_context");
      expect(executedWorkPackWorkflowRunExitCode(executed)).toBe(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
