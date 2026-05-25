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
      env: {
        RUNSTEAD_RUNTIME_BACKEND: "postgres",
        RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
        RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
        RUNSTEAD_TEAM_ORG_ID: "org_123",
        RUNSTEAD_TEAM_WORKSPACE_ID: "workspace_123",
        RUNSTEAD_RUNNER_ID: "runner_1,runner_2",
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
        appendOnlyAudit: true,
        organizationAuthz: true
      }
    });
    expect(selection.teamProfile?.scope).toEqual({
      kind: "team",
      organizationId: "org_123",
      workspaceId: "workspace_123"
    });
  });
});
