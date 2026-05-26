import { describe, expect, it } from "vitest";

import { resolveRuntimeBackendSelection } from "./index.js";

describe("runtime backend config", () => {
  it("defaults to local SQLite storage", () => {
    const selection = resolveRuntimeBackendSelection({
      rootPath: "/repo/.runstead",
      env: {}
    });

    expect(selection).toMatchObject({
      backend: "sqlite",
      setupBlockers: [],
      warnings: []
    });
    expect(selection.storage).toMatchObject({
      backend: "sqlite",
      stateUri: "file:///repo/.runstead/state.db"
    });
  });

  it("reports missing Postgres team configuration", () => {
    const selection = resolveRuntimeBackendSelection({
      rootPath: "/repo/.runstead",
      env: {
        RUNSTEAD_RUNTIME_BACKEND: "postgres",
        RUNSTEAD_POSTGRES_URL: "postgres://runstead/state"
      }
    });

    expect(selection.backend).toBe("postgres");
    expect(selection.storage).toMatchObject({
      backend: "postgres",
      stateUri: "postgres://runstead/state"
    });
    expect(selection.setupBlockers).toEqual([
      "RUNSTEAD_ARTIFACT_BASE_URI is required for RUNSTEAD_RUNTIME_BACKEND=postgres",
      "RUNSTEAD_TEAM_ORG_ID is required for RUNSTEAD_RUNTIME_BACKEND=postgres",
      "RUNSTEAD_RUNNER_ID is required for RUNSTEAD_RUNTIME_BACKEND=postgres",
      "RUNSTEAD_AUDIT_SINK_URI is required for RUNSTEAD_RUNTIME_BACKEND=postgres"
    ]);
    expect(selection.teamAssessment).toBeUndefined();
  });

  it("builds an assessed Postgres team profile from environment config", () => {
    const selection = resolveRuntimeBackendSelection({
      rootPath: "/repo/.runstead",
      now: new Date("2026-05-24T00:00:15.000Z"),
      env: {
        RUNSTEAD_RUNTIME_BACKEND: "postgres",
        RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
        RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
        RUNSTEAD_TEAM_ORG_ID: "org_123",
        RUNSTEAD_TEAM_WORKSPACE_ID: "workspace_123",
        RUNSTEAD_RUNNER_ID: "runner_1,runner_2",
        RUNSTEAD_RUNNER_LAST_SEEN_AT:
          "runner_1=2026-05-24T00:00:00.000Z,runner_2=2026-05-24T00:00:01.000Z",
        RUNSTEAD_AUDIT_SINK_URI: "s3://runstead/audit"
      }
    });

    expect(selection.backend).toBe("postgres");
    expect(selection.setupBlockers).toEqual([]);
    expect(selection.teamAssessment).toMatchObject({
      passed: true,
      capabilities: {
        sharedStorage: true,
        distributedLeases: true,
        registeredRunners: 2,
        freshRunnerHeartbeats: 2,
        appendOnlyAudit: true,
        organizationAuthz: true
      }
    });
    expect(selection.teamProfile?.scope).toEqual({
      kind: "team",
      organizationId: "org_123",
      workspaceId: "workspace_123"
    });
    expect(selection.teamProfile?.runners).toEqual([
      expect.objectContaining({
        runnerId: "runner_1",
        lastSeenAt: "2026-05-24T00:00:00.000Z"
      }),
      expect.objectContaining({
        runnerId: "runner_2",
        lastSeenAt: "2026-05-24T00:00:01.000Z"
      })
    ]);
  });

  it("blocks Postgres team mode when runner heartbeats are missing by default", () => {
    const selection = resolveRuntimeBackendSelection({
      rootPath: "/repo/.runstead",
      now: new Date("2026-05-24T00:00:15.000Z"),
      env: {
        RUNSTEAD_RUNTIME_BACKEND: "postgres",
        RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
        RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
        RUNSTEAD_TEAM_ORG_ID: "org_123",
        RUNSTEAD_RUNNER_ID: "runner_1",
        RUNSTEAD_AUDIT_SINK_URI: "s3://runstead/audit"
      }
    });

    expect(selection.setupBlockers).toContain(
      "at least one fresh active runner heartbeat is required"
    );
    expect(selection.warnings).toContain(
      "runner heartbeat timestamps are not recorded; live runner availability is not proven"
    );
    expect(selection.teamAssessment?.capabilities.freshRunnerHeartbeats).toBe(0);
  });

  it("can warn instead of block when heartbeat enforcement is explicitly disabled", () => {
    const selection = resolveRuntimeBackendSelection({
      rootPath: "/repo/.runstead",
      now: new Date("2026-05-24T00:00:15.000Z"),
      env: {
        RUNSTEAD_RUNTIME_BACKEND: "postgres",
        RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
        RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
        RUNSTEAD_TEAM_ORG_ID: "org_123",
        RUNSTEAD_RUNNER_ID: "runner_1",
        RUNSTEAD_REQUIRE_RUNNER_HEARTBEAT: "false",
        RUNSTEAD_AUDIT_SINK_URI: "s3://runstead/audit"
      }
    });

    expect(selection.setupBlockers).toEqual([]);
    expect(selection.warnings).toContain(
      "runner heartbeat timestamps are not recorded; live runner availability is not proven"
    );
  });
});
