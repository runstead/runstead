import { describe, expect, it } from "vitest";

import {
  formatWorkPackWorkflowRunPlan,
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
});
