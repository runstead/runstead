export type ReadinessTarget = "local" | "staging" | "production";

export type ReadinessVerdict =
  | "not_evaluated"
  | "local_launch_ready"
  | "local_launch_blocked"
  | "staging_launch_ready"
  | "staging_launch_blocked"
  | "public_launch_ready"
  | "public_launch_blocked";

export type ReadinessEvidenceTier =
  | "synthetic_smoke"
  | "local_manual"
  | "local_command"
  | "ci_verified"
  | "staging_deployment"
  | "production_deployment"
  | "real_user_analytics"
  | "support_ticket"
  | "security_scan";

export type ReadinessFacetKind =
  | "phase"
  | "evidence_tier"
  | "evidence_type"
  | "freshness";

export type ReadinessFacetStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked"
  | "failed"
  | "skipped"
  | "warning";

export interface ReadinessPlanPhase {
  id: string;
  title: string;
  status: string;
  evidenceIds?: string[];
  blockers?: string[];
}

export interface ReadinessFacet {
  kind: ReadinessFacetKind;
  key: string;
  status: ReadinessFacetStatus;
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
}

export interface CompileReadinessPlanInput {
  target: ReadinessTarget;
  stage?: string;
  phases: ReadinessPlanPhase[];
  evidenceTiers: string[];
  evidenceTypes?: string[];
  staleEvidenceRefs?: string[];
  supersededEvidenceRefs?: string[];
}

export interface CompiledReadinessPlan {
  schemaVersion: 1;
  target: ReadinessTarget;
  stage?: string;
  phases: ReadinessPlanPhase[];
  facets: ReadinessFacet[];
  evidenceTiers: string[];
  evidenceTypes: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}

export interface ReadinessVerdictDecision {
  target: ReadinessTarget;
  verdict: ReadinessVerdict;
  canLaunch: boolean;
  blockers: string[];
  warnings: string[];
  evidenceRefs: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}

export interface ReadinessVerdictResult extends ReadinessVerdictDecision {
  targetReadiness: {
    local: ReadinessVerdictDecision;
    staging: ReadinessVerdictDecision;
    production: ReadinessVerdictDecision;
  };
}

export function compileReadinessPlan(
  input: CompileReadinessPlanInput
): CompiledReadinessPlan {
  const evidenceTiers = uniqueStrings(input.evidenceTiers);
  const evidenceTypes = uniqueStrings(input.evidenceTypes ?? []);
  const staleEvidenceRefs = uniqueStrings(input.staleEvidenceRefs ?? []);
  const supersededEvidenceRefs = uniqueStrings(input.supersededEvidenceRefs ?? []);
  const facets: ReadinessFacet[] = [
    ...input.phases.map((phase) => readinessPhaseFacet(phase)),
    ...evidenceTiers.map((tier) => readinessEvidenceFacet("evidence_tier", tier)),
    ...evidenceTypes.map((type) => readinessEvidenceFacet("evidence_type", type)),
    ...staleEvidenceRefs.map((ref) =>
      readinessWarningFacet("freshness", ref, [
        `stale evidence is excluded from readiness verdict: ${ref}`
      ])
    ),
    ...supersededEvidenceRefs.map((ref) =>
      readinessWarningFacet("freshness", ref, [
        `superseded evidence is excluded from readiness verdict: ${ref}`
      ])
    )
  ];

  return {
    schemaVersion: 1,
    target: input.target,
    ...(input.stage === undefined ? {} : { stage: input.stage }),
    phases: input.phases.map((phase) => ({ ...phase })),
    facets,
    evidenceTiers,
    evidenceTypes,
    staleEvidenceRefs,
    supersededEvidenceRefs
  };
}

export function evaluateCompiledReadinessPlan(
  plan: CompiledReadinessPlan
): ReadinessVerdictResult {
  const targetReadiness = {
    local: evaluateReadinessTargetVerdict(plan, "local"),
    staging: evaluateReadinessTargetVerdict(plan, "staging"),
    production: evaluateReadinessTargetVerdict(plan, "production")
  };
  const requested = targetReadiness[plan.target];

  return {
    ...requested,
    targetReadiness
  };
}

export function readinessVerdictReady(verdict: string): boolean {
  return [
    "local_launch_ready",
    "staging_launch_ready",
    "public_launch_ready"
  ].includes(verdict);
}

export function readinessVerdictForTarget(
  target: ReadinessTarget,
  ready: boolean
): ReadinessVerdict {
  if (target === "local") {
    return ready ? "local_launch_ready" : "local_launch_blocked";
  }

  if (target === "staging") {
    return ready ? "staging_launch_ready" : "staging_launch_blocked";
  }

  return ready ? "public_launch_ready" : "public_launch_blocked";
}

function evaluateReadinessTargetVerdict(
  plan: CompiledReadinessPlan,
  target: ReadinessTarget
): ReadinessVerdictDecision {
  const evidenceRefs = uniqueStrings(
    plan.phases.flatMap((phase) => phase.evidenceIds ?? [])
  );
  const phaseBlockers = plan.phases
    .filter((phase) => phase.status === "blocked" || phase.status === "failed")
    .map((phase) => `${phase.title} is ${phase.status}`);
  const tierBlockers = missingReadinessEvidenceBlockers({
    target,
    phases: plan.phases,
    evidenceTiers: plan.evidenceTiers,
    evidenceTypes: plan.evidenceTypes
  });
  const blockers = uniqueStrings([...phaseBlockers, ...tierBlockers]);
  const warnings = uniqueStrings([
    ...plan.staleEvidenceRefs.map(
      (ref) => `stale evidence is excluded from readiness verdict: ${ref}`
    ),
    ...plan.supersededEvidenceRefs.map(
      (ref) => `superseded evidence is excluded from readiness verdict: ${ref}`
    )
  ]);
  const ready = blockers.length === 0;

  return {
    target,
    verdict: readinessVerdictForTarget(target, ready),
    canLaunch: ready,
    blockers,
    warnings,
    evidenceRefs,
    staleEvidenceRefs: plan.staleEvidenceRefs,
    supersededEvidenceRefs: plan.supersededEvidenceRefs
  };
}

function missingReadinessEvidenceBlockers(input: {
  target: ReadinessTarget;
  phases: ReadinessPlanPhase[];
  evidenceTiers: string[];
  evidenceTypes: string[];
}): string[] {
  const tiers = new Set(input.evidenceTiers);
  const evidenceTypes = new Set(input.evidenceTypes);
  const requiresUiSmoke = input.phases.some((phase) => phase.id === "ui_smoke");
  const blockers = [
    ...(tiers.has("local_command")
      ? []
      : ["local command verifier evidence is required"])
  ];

  if (requiresUiSmoke && !tiers.has("synthetic_smoke")) {
    blockers.push("synthetic UI smoke evidence is required");
  }

  if (input.target === "local") {
    return blockers;
  }

  if (!tiers.has("ci_verified")) {
    blockers.push("CI-verified evidence is required for staging or production");
  }

  if (input.target === "staging") {
    if (!tiers.has("staging_deployment")) {
      blockers.push("staging deployment evidence is required");
    }

    if (!evidenceTypes.has("startup_rollback_drill")) {
      blockers.push("rollback drill evidence is required for staging");
    }

    if (!evidenceTypes.has("startup_monitoring_alerts")) {
      blockers.push("monitoring alert evidence is required for staging");
    }

    if (!evidenceTypes.has("startup_migration_validation")) {
      blockers.push("migration validation evidence is required for staging");
    }

    return blockers;
  }

  if (!tiers.has("production_deployment")) {
    blockers.push("production deployment evidence is required");
  }

  if (!tiers.has("real_user_analytics")) {
    blockers.push("real-user analytics evidence is required");
  }

  if (!tiers.has("support_ticket")) {
    blockers.push("support or feedback triage evidence is required");
  }

  if (!tiers.has("security_scan")) {
    blockers.push("security scan evidence is required");
  }

  if (!evidenceTypes.has("startup_rollback_plan")) {
    blockers.push("rollback-plan evidence is required");
  }

  if (!evidenceTypes.has("startup_rollback_drill")) {
    blockers.push("rollback drill evidence is required");
  }

  if (!evidenceTypes.has("startup_observability")) {
    blockers.push("observability evidence is required");
  }

  if (!evidenceTypes.has("startup_monitoring_alerts")) {
    blockers.push("monitoring alert evidence is required");
  }

  if (!evidenceTypes.has("startup_error_budget")) {
    blockers.push("error budget evidence is required");
  }

  if (!evidenceTypes.has("startup_migration_validation")) {
    blockers.push("migration validation evidence is required");
  }

  if (!evidenceTypes.has("startup_traffic_gate")) {
    blockers.push("real-user traffic gate evidence is required");
  }

  if (!evidenceTypes.has("startup_post_launch_watch")) {
    blockers.push("post-launch watch evidence is required");
  }

  return blockers;
}

function readinessPhaseFacet(phase: ReadinessPlanPhase): ReadinessFacet {
  return {
    kind: "phase",
    key: phase.id,
    status: normalizeReadinessFacetStatus(phase.status),
    evidenceIds: phase.evidenceIds ?? [],
    blockers:
      phase.status === "blocked" || phase.status === "failed"
        ? [phase.blockers?.[0] ?? `${phase.title} is ${phase.status}`]
        : [],
    warnings: []
  };
}

function readinessEvidenceFacet(
  kind: "evidence_tier" | "evidence_type",
  key: string
): ReadinessFacet {
  return {
    kind,
    key,
    status: "passed",
    evidenceIds: [],
    blockers: [],
    warnings: []
  };
}

function readinessWarningFacet(
  kind: "freshness",
  key: string,
  warnings: string[]
): ReadinessFacet {
  return {
    kind,
    key,
    status: "warning",
    evidenceIds: [key],
    blockers: [],
    warnings
  };
}

function normalizeReadinessFacetStatus(status: string): ReadinessFacetStatus {
  if (
    status === "pending" ||
    status === "running" ||
    status === "passed" ||
    status === "blocked" ||
    status === "failed" ||
    status === "skipped" ||
    status === "warning"
  ) {
    return status;
  }

  return "pending";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
