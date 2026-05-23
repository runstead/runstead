import { describe, expect, it } from "vitest";

import {
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

    const result = assessTeamControlPlaneReadiness(profile);

    expect(result).toEqual({
      target: "team",
      passed: true,
      blockers: [],
      warnings: [],
      capabilities: {
        sharedStorage: true,
        distributedLeases: true,
        registeredRunners: 2,
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
});
