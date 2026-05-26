import { describe, expect, it } from "vitest";

import {
  createReadinessRunSnapshotEvent,
  readinessRunGovernanceProfile
} from "./readiness-run.js";

describe("readiness run snapshots", () => {
  it("creates startup readiness snapshot events for audit replay", () => {
    const event = createReadinessRunSnapshotEvent(
      {
        schemaVersion: 1,
        id: "run_123",
        cwd: "/workspace/todo",
        stage: "launch",
        target: "local",
        worker: "codex_direct",
        runtimeBackend: {
          backend: "postgres",
          storageUri: "postgres://runstead/state",
          setupBlockers: []
        },
        status: "completed",
        phases: [
          {
            id: "ui_smoke",
            title: "UI smoke",
            status: "passed",
            evidenceIds: ["ev_ui"],
            artifacts: ["ui.png"],
            blockers: []
          }
        ],
        evidenceIds: ["ev_ui"],
        evidenceTiers: ["synthetic_smoke", "local_command"],
        evidenceTypes: ["command_output"],
        verdict: "local_launch_ready",
        verdictBlockers: [],
        reportPaths: ["report.md"],
        guidedFlow: [],
        operatorCommands: [],
        startedAt: "2026-05-24T00:00:00.000Z",
        completedAt: "2026-05-24T00:10:00.000Z",
        dirtyState: "clean"
      },
      {
        path: "/workspace/todo/.runstead/startup/readiness-runs/run_123.json"
      }
    );

    expect(event).toMatchObject({
      type: "startup_readiness.run_snapshot",
      aggregateType: "startup_readiness_run",
      aggregateId: "run_123",
      createdAt: "2026-05-24T00:10:00.000Z"
    });
    expect(event.payload).toMatchObject({
      runId: "run_123",
      worker: "codex_direct",
      governanceProfile: "governed",
      runtimeBackend: {
        backend: "postgres",
        storageUri: "postgres://runstead/state"
      },
      verdict: "local_launch_ready",
      evidenceTiers: ["synthetic_smoke", "local_command"],
      phases: [
        {
          id: "ui_smoke",
          status: "passed",
          evidenceIds: ["ev_ui"]
        }
      ]
    });
  });

  it("keeps wrapped workers on the readiness governance boundary by default", () => {
    expect(
      readinessRunGovernanceProfile({
        worker: "codex_cli"
      })
    ).toBe("readiness");
  });
});
