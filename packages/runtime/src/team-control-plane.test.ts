import { describe, expect, it } from "vitest";

import {
  assessRuntimeRunnerHeartbeat,
  assessTeamControlPlaneReadiness,
  type RuntimeTeamControlPlaneProfile
} from "./index.js";

describe("team control-plane contracts", () => {
  it("blocks local SQLite profiles from being treated as team control planes", () => {
    const result = assessTeamControlPlaneReadiness({
      scope: {
        kind: "local",
        workspaceId: "workspace_local"
      },
      storage: {
        backend: "sqlite",
        stateUri: "file:///repo/.runstead/state.db"
      },
      runners: [],
      leasePolicy: {
        backend: "local_file",
        fencingTokens: false,
        heartbeatTtlMs: 30_000
      },
      auditSinks: [
        {
          id: "local-sqlite",
          type: "sqlite",
          uri: "file:///repo/.runstead/state.db",
          tamperEvidence: "none"
        }
      ],
      authz: {
        identityProvider: "local",
        rbac: false,
        tenantIsolation: "none",
        secretsBoundary: "local_env"
      }
    });

    expect(result.passed).toBe(false);
    expect(result.capabilities).toEqual({
      sharedStorage: false,
      distributedLeases: false,
      registeredRunners: 0,
      freshRunnerHeartbeats: 0,
      appendOnlyAudit: false,
      organizationAuthz: false
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "scope must be team for organization-level control planes",
        "team control planes require shared transactional storage instead of local SQLite",
        "at least one active registered runner is required"
      ])
    );
  });

  it("passes a shared team profile with runners, leases, audit, and authz", () => {
    const profile: RuntimeTeamControlPlaneProfile = {
      scope: {
        kind: "team",
        organizationId: "org_123",
        workspaceId: "workspace_prod"
      },
      storage: {
        backend: "postgres",
        stateUri: "postgres://runstead-control-plane/state",
        artifactBaseUri: "s3://runstead-audit/evidence"
      },
      runners: [
        {
          runnerId: "runner_1",
          organizationId: "org_123",
          workspaceId: "workspace_prod",
          labels: ["linux", "codex_direct"],
          status: "active",
          lastSeenAt: "2026-05-24T00:00:00.000Z"
        },
        {
          runnerId: "runner_2",
          organizationId: "org_123",
          workspaceId: "workspace_prod",
          labels: ["linux", "verifier"],
          status: "active",
          lastSeenAt: "2026-05-24T00:00:01.000Z"
        }
      ],
      leasePolicy: {
        backend: "distributed_lock",
        fencingTokens: true,
        heartbeatTtlMs: 30_000
      },
      auditSinks: [
        {
          id: "audit-log",
          type: "object_store",
          uri: "s3://runstead-audit/events",
          tamperEvidence: "hash_chain",
          retentionDays: 365
        }
      ],
      authz: {
        identityProvider: "oidc",
        rbac: true,
        tenantIsolation: "organization",
        secretsBoundary: "central_secret_store"
      }
    };

    const result = assessTeamControlPlaneReadiness(profile, {
      now: new Date("2026-05-24T00:00:15.000Z"),
      requireRunnerHeartbeats: true
    });

    expect(result).toEqual({
      target: "team",
      passed: true,
      blockers: [],
      warnings: [],
      capabilities: {
        sharedStorage: true,
        distributedLeases: true,
        registeredRunners: 2,
        freshRunnerHeartbeats: 2,
        appendOnlyAudit: true,
        organizationAuthz: true
      }
    });
  });

  it("warns when a team profile lacks runner failover or long audit retention", () => {
    const result = assessTeamControlPlaneReadiness({
      scope: {
        kind: "team",
        organizationId: "org_123"
      },
      storage: {
        backend: "custom",
        stateUri: "https://control-plane.internal/state"
      },
      runners: [
        {
          runnerId: "runner_1",
          labels: ["macos"],
          status: "active"
        }
      ],
      leasePolicy: {
        backend: "database",
        fencingTokens: true,
        heartbeatTtlMs: 30_000
      },
      auditSinks: [
        {
          id: "audit-webhook",
          type: "webhook",
          uri: "https://audit.example.com/runstead",
          tamperEvidence: "append_only",
          retentionDays: 30
        }
      ],
      authz: {
        identityProvider: "saml",
        rbac: true,
        tenantIsolation: "workspace",
        secretsBoundary: "custom"
      }
    });

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([
      "some audit sinks retain records for fewer than 90 days",
      "only one active runner is registered; failover is not covered"
    ]);
  });

  it("can require fresh runner heartbeats for stricter team readiness", () => {
    const profile: RuntimeTeamControlPlaneProfile = {
      scope: {
        kind: "team",
        organizationId: "org_123"
      },
      storage: {
        backend: "postgres",
        stateUri: "postgres://runstead/state"
      },
      runners: [
        {
          runnerId: "runner_stale",
          labels: ["linux"],
          status: "active",
          lastSeenAt: "2026-05-24T00:00:00.000Z"
        }
      ],
      leasePolicy: {
        backend: "database",
        fencingTokens: true,
        heartbeatTtlMs: 30_000
      },
      auditSinks: [
        {
          id: "audit",
          type: "object_store",
          uri: "s3://runstead/audit",
          tamperEvidence: "hash_chain"
        }
      ],
      authz: {
        identityProvider: "oidc",
        rbac: true,
        tenantIsolation: "organization",
        secretsBoundary: "central_secret_store"
      }
    };

    const result = assessTeamControlPlaneReadiness(profile, {
      now: new Date("2026-05-24T00:01:00.000Z"),
      requireRunnerHeartbeats: true
    });

    expect(result.passed).toBe(false);
    expect(result.blockers).toContain(
      "at least one fresh active runner heartbeat is required"
    );
    expect(result.warnings).toContain("some active runner heartbeats are stale");
    expect(result.capabilities.freshRunnerHeartbeats).toBe(0);
  });

  it("classifies individual runner heartbeat timestamps", () => {
    expect(
      assessRuntimeRunnerHeartbeat({
        runner: {
          runnerId: "runner_fresh",
          labels: [],
          status: "active",
          lastSeenAt: "2026-05-24T00:00:00.000Z"
        },
        heartbeatTtlMs: 30_000,
        now: new Date("2026-05-24T00:00:10.000Z")
      })
    ).toMatchObject({
      runnerId: "runner_fresh",
      fresh: true,
      stale: false,
      ageMs: 10_000
    });
    expect(
      assessRuntimeRunnerHeartbeat({
        runner: {
          runnerId: "runner_missing",
          labels: [],
          status: "active"
        },
        heartbeatTtlMs: 30_000,
        now: new Date("2026-05-24T00:00:10.000Z")
      })
    ).toMatchObject({
      runnerId: "runner_missing",
      fresh: false,
      missing: true
    });
  });
});
