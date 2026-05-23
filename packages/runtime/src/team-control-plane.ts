import type { RuntimeStorageIdentity } from "./control-plane.js";

export type RuntimeControlPlaneScope =
  | {
      kind: "local";
      workspaceId?: string;
    }
  | {
      kind: "team";
      organizationId: string;
      workspaceId?: string;
    };

export interface RuntimeRunnerRegistration {
  runnerId: string;
  organizationId?: string;
  workspaceId?: string;
  labels: string[];
  status: "active" | "draining" | "offline";
  lastSeenAt?: string;
}

export interface RuntimeRunnerLeasePolicy {
  backend: "local_file" | "database" | "distributed_lock" | "custom";
  fencingTokens: boolean;
  heartbeatTtlMs: number;
}

export interface RuntimeRunnerLease {
  leaseId: string;
  runnerId: string;
  resource: string;
  token: string;
  expiresAt: string;
  fencingToken?: string;
}

export interface RuntimeAuditSink {
  id: string;
  type: "sqlite" | "object_store" | "webhook" | "siem" | "custom";
  uri: string;
  tamperEvidence: "none" | "hash_chain" | "append_only";
  retentionDays?: number;
}

export interface RuntimeTeamAuthzPolicy {
  identityProvider: "local" | "oidc" | "saml" | "custom";
  rbac: boolean;
  tenantIsolation: "none" | "workspace" | "organization";
  secretsBoundary: "local_env" | "central_secret_store" | "custom";
}

export interface RuntimeTeamControlPlaneProfile {
  scope: RuntimeControlPlaneScope;
  storage: RuntimeStorageIdentity;
  runners: RuntimeRunnerRegistration[];
  leasePolicy: RuntimeRunnerLeasePolicy;
  auditSinks: RuntimeAuditSink[];
  authz: RuntimeTeamAuthzPolicy;
}

export interface RuntimeTeamControlPlaneAssessment {
  target: "team";
  passed: boolean;
  blockers: string[];
  warnings: string[];
  capabilities: {
    sharedStorage: boolean;
    distributedLeases: boolean;
    registeredRunners: number;
    appendOnlyAudit: boolean;
    organizationAuthz: boolean;
  };
}

export function assessTeamControlPlaneReadiness(
  profile: RuntimeTeamControlPlaneProfile
): RuntimeTeamControlPlaneAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const activeRunners = profile.runners.filter((runner) => runner.status === "active");
  const appendOnlyAudit = profile.auditSinks.some(
    (sink) =>
      sink.tamperEvidence === "append_only" || sink.tamperEvidence === "hash_chain"
  );
  const sharedStorage =
    profile.scope.kind === "team" && profile.storage.backend !== "sqlite";
  const distributedLeases =
    profile.leasePolicy.backend === "database" ||
    profile.leasePolicy.backend === "distributed_lock" ||
    profile.leasePolicy.backend === "custom";
  const organizationAuthz =
    profile.authz.rbac &&
    profile.authz.tenantIsolation !== "none" &&
    profile.authz.identityProvider !== "local" &&
    profile.authz.secretsBoundary !== "local_env";

  if (profile.scope.kind !== "team") {
    blockers.push("scope must be team for organization-level control planes");
  }

  if (!sharedStorage) {
    blockers.push(
      "team control planes require shared transactional storage instead of local SQLite"
    );
  }

  if (activeRunners.length === 0) {
    blockers.push("at least one active registered runner is required");
  }

  if (!distributedLeases || !profile.leasePolicy.fencingTokens) {
    blockers.push(
      "runner coordination requires distributed leases with fencing tokens"
    );
  }

  if (!appendOnlyAudit) {
    blockers.push("audit export must include an append-only or hash-chain sink");
  }

  if (!organizationAuthz) {
    blockers.push(
      "organization authz requires non-local identity, RBAC, tenant isolation, and non-local secret boundaries"
    );
  }

  if (
    profile.auditSinks.some(
      (sink) => sink.retentionDays !== undefined && sink.retentionDays < 90
    )
  ) {
    warnings.push("some audit sinks retain records for fewer than 90 days");
  }

  if (activeRunners.length === 1) {
    warnings.push("only one active runner is registered; failover is not covered");
  }

  return {
    target: "team",
    passed: blockers.length === 0,
    blockers,
    warnings,
    capabilities: {
      sharedStorage,
      distributedLeases: distributedLeases && profile.leasePolicy.fencingTokens,
      registeredRunners: activeRunners.length,
      appendOnlyAudit,
      organizationAuthz
    }
  };
}
