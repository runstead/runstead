import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import {
  executeStartupRemediationPlan,
  formatStartupRemediationExecution,
  formatStartupRemediationPlan,
  generateStartupRemediationPlan,
  supersedeStartupRemediationTasks
} from "./startup-remediation.js";
import { listTasks } from "./tasks.js";

describe("startup remediation", () => {
  it("turns launch blockers into idempotent worker-ready tasks", async () => {
    const workspace = join(tmpdir(), `runstead-startup-remediate-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });

      const first = await generateStartupRemediationPlan({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:10:00.000Z")
      });
      const formatted = formatStartupRemediationPlan(first);
      const measurementTask = first.tasks.find((item) =>
        /metric|measurement/.test(item.blocker.toLowerCase())
      );

      expect(first.status).toBe("blocked");
      expect(first.reportPath).toContain("launch-readiness-ai-native-startup.md");
      expect(first.tasks).toHaveLength(first.blockers.length);
      expect(first.tasks.every((item) => !item.reused)).toBe(true);
      expect(first.plan.nodes).toHaveLength(first.tasks.length);
      expect(first.plan.edges.length).toBeGreaterThan(0);
      expect(measurementTask?.task).toMatchObject({
        type: "startup_remediation",
        status: "queued",
        priority: "high",
        input: {
          stage: "launch",
          workerCandidates: ["codex_cli", "claude_code"],
          verifier: "runstead startup gate check --stage launch",
          expectedEvidence: ["startup_metric", "startup_measurement_framework"],
          acceptanceCriteria: [
            "measurement framework or metric snapshot evidence is recorded",
            "metric source, threshold, current value, and freshness are reviewable"
          ],
          completionEvidence: [
            "diff_ref",
            "checkpoint_ref",
            "verifier_evidence_id",
            "updated_gate_event_id",
            "updated_report_path"
          ]
        }
      });
      expect(measurementTask?.severity).toBe("critical");
      expect(measurementTask?.acceptanceCriteria).toContain(
        "measurement framework or metric snapshot evidence is recorded"
      );
      expect(first.tasks[1]?.dependsOn).toContain(first.tasks[0]?.task.id);
      expect(measurementTask?.task.verifiers).toEqual([
        "evidence:startup_metric",
        "command:startup_gate_check"
      ]);
      expect(formatted).toContain("Startup remediation: launch");
      expect(formatted).toContain("runstead startup gate check --stage launch");
      expect(formatted).toContain("runstead startup launch report");

      const second = await generateStartupRemediationPlan({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:20:00.000Z")
      });
      const persistedTasks = listTasks({ cwd: workspace }).tasks.filter(
        (task) => task.type === "startup_remediation"
      );

      expect(second.tasks).toHaveLength(first.tasks.length);
      expect(second.tasks.every((item) => item.reused)).toBe(true);
      expect(persistedTasks).toHaveLength(first.tasks.length);

      const cliOutput = await runCli(
        "startup",
        "remediate",
        "--cwd",
        workspace,
        "--stage",
        "launch"
      );

      expect(cliOutput).toContain("Startup remediation: launch");
      expect(cliOutput).toContain("(reused)");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("supersedes stale remediation tasks when readiness blockers clear", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-remediate-supersede-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });
      const plan = await generateStartupRemediationPlan({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:10:00.000Z")
      });

      const superseded = await supersedeStartupRemediationTasks({
        cwd: workspace,
        stage: "launch",
        activeBlockers: [],
        runId: "run_ready_123",
        now: new Date("2026-05-14T03:20:00.000Z")
      });
      const tasks = listTasks({ cwd: workspace }).tasks.filter(
        (task) => task.type === "startup_remediation"
      );
      const nextPlan = await generateStartupRemediationPlan({
        cwd: workspace,
        stage: "launch",
        now: new Date("2026-05-14T03:30:00.000Z")
      });

      expect(superseded.supersededTasks).toHaveLength(plan.tasks.length);
      expect(tasks.every((task) => task.status === "cancelled")).toBe(true);
      expect(tasks[0]?.output?.superseded).toMatchObject({
        byRunId: "run_ready_123",
        reason: "latest startup readiness verdict has no active blockers"
      });
      expect(nextPlan.tasks.every((item) => !item.reused)).toBe(true);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("executes a bounded remediation loop through a wrapped worker", async () => {
    const workspace = join(
      tmpdir(),
      `runstead-startup-remediate-execute-${process.pid}`
    );

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace, profile: "trusted-local" });
      await installDomainPack({
        cwd: workspace,
        ref: "ai-native-startup",
        now: new Date("2026-05-14T02:00:00.000Z")
      });
      await createGoal({
        cwd: workspace,
        domain: "ai-native-startup",
        template: "build-mvp",
        now: new Date("2026-05-14T03:00:00.000Z")
      });

      const result = await executeStartupRemediationPlan({
        cwd: workspace,
        stage: "launch",
        worker: "codex_cli",
        maxTasks: 1,
        now: new Date("2026-05-14T03:10:00.000Z"),
        workerRunner: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              summary: "recorded remediation attempt",
              files_changed: [],
              commands_run: [],
              risks: [],
              needs_approval: false,
              approval_reason: null
            }),
            stderr: "",
            exitCode: 0
          })
      });
      const formatted = formatStartupRemediationExecution(result);
      const localAgentTasks = listTasks({ cwd: workspace }).tasks.filter(
        (task) => task.type === "local_agent_task"
      );
      const remediationTasks = listTasks({ cwd: workspace }).tasks.filter(
        (task) => task.type === "startup_remediation"
      );
      const executedRemediationTask = remediationTasks.find(
        (task) => task.id === result.executed[0]?.remediationTaskId
      );

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]).toMatchObject({
        status: "completed",
        resolved: false
      });
      expect(result.executed[0]?.failureEvidenceId).toMatch(/^ev_/);
      expect(result.finalGate.passed).toBe(false);
      expect(result.executionOutcome).toBe("blocked");
      expect(result.budget).toMatchObject({
        maxTasks: 1,
        selectedTasks: 1
      });
      expect(localAgentTasks).toHaveLength(1);
      expect(executedRemediationTask?.output).toMatchObject({
        execution: {
          localAgentTaskId: localAgentTasks[0]?.id,
          status: "completed",
          resolved: false
        }
      });
      expect(formatted).toContain("Execution:");
      expect(formatted).toContain("Worker: codex_cli");
      expect(formatted).toContain("failureEvidence=");
      expect(formatted).toContain("Final gate:");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function runCli(...args: string[]): Promise<string> {
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...items: unknown[]) => {
    output.push(items.map(String).join(" "));
  });

  try {
    await createProgram({ entrypoint: "/usr/local/bin/runstead" }).parseAsync(args, {
      from: "user"
    });
  } finally {
    log.mockRestore();
  }

  return output.join("\n");
}
