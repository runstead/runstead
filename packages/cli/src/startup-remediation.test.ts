import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import {
  formatStartupRemediationPlan,
  generateStartupRemediationPlan
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
      const metricTask = first.tasks.find((item) =>
        item.blocker.toLowerCase().includes("metric")
      );

      expect(first.status).toBe("blocked");
      expect(first.reportPath).toContain("launch-readiness-ai-native-startup.md");
      expect(first.tasks).toHaveLength(first.blockers.length);
      expect(first.tasks.every((item) => !item.reused)).toBe(true);
      expect(metricTask?.task).toMatchObject({
        type: "startup_remediation",
        status: "queued",
        priority: "high",
        input: {
          stage: "launch",
          workerCandidates: ["codex_cli", "claude_code"],
          verifier: "runstead startup gate check --stage launch",
          expectedEvidence: ["startup_metric", "startup_measurement_framework"],
          completionEvidence: [
            "diff_ref",
            "checkpoint_ref",
            "verifier_evidence_id",
            "updated_gate_event_id",
            "updated_report_path"
          ]
        }
      });
      expect(metricTask?.task.verifiers).toEqual([
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
