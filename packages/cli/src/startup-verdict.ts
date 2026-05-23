export type StartupVerdictTarget = "local" | "staging" | "production";

export type StartupVerdict =
  | "not_evaluated"
  | "local_launch_ready"
  | "local_launch_blocked"
  | "staging_launch_ready"
  | "staging_launch_blocked"
  | "public_launch_ready"
  | "public_launch_blocked";

export type StartupVerdictEvidenceTier =
  | "synthetic_smoke"
  | "local_manual"
  | "local_command"
  | "ci_verified"
  | "staging_deployment"
  | "production_deployment"
  | "real_user_analytics"
  | "support_ticket"
  | "security_scan";

export interface StartupVerdictPhase {
  id: string;
  title: string;
  status: string;
  evidenceIds?: string[];
  blockers?: string[];
}

export interface StartupVerdictInput {
  target: StartupVerdictTarget;
  phases: StartupVerdictPhase[];
  evidenceTiers: string[];
  evidenceTypes?: string[];
  staleEvidenceRefs?: string[];
  supersededEvidenceRefs?: string[];
}

export interface StartupVerdictDecision {
  target: StartupVerdictTarget;
  verdict: StartupVerdict;
  canLaunch: boolean;
  blockers: string[];
  warnings: string[];
  evidenceRefs: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}

export interface StartupVerdictResult extends StartupVerdictDecision {
  targetReadiness: {
    local: StartupVerdictDecision;
    staging: StartupVerdictDecision;
    production: StartupVerdictDecision;
  };
}

export function evaluateStartupVerdict(
  input: StartupVerdictInput
): StartupVerdictResult {
  const targetReadiness = {
    local: evaluateStartupTargetVerdict({ ...input, target: "local" }),
    staging: evaluateStartupTargetVerdict({ ...input, target: "staging" }),
    production: evaluateStartupTargetVerdict({ ...input, target: "production" })
  };
  const requested = targetReadiness[input.target];

  return {
    ...requested,
    targetReadiness
  };
}

export function evaluateStartupTargetVerdict(
  input: StartupVerdictInput
): StartupVerdictDecision {
  const evidenceRefs = uniqueStrings(
    input.phases.flatMap((phase) => phase.evidenceIds ?? [])
  );
  const phaseBlockers = input.phases
    .filter((phase) => phase.status === "blocked" || phase.status === "failed")
    .map((phase) => `${phase.title} is ${phase.status}`);
  const tierBlockers = missingStartupEvidenceBlockers({
    target: input.target,
    phases: input.phases,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes ?? []
  });
  const blockers = uniqueStrings([...phaseBlockers, ...tierBlockers]);
  const warnings = [
    ...(input.staleEvidenceRefs ?? []).map(
      (ref) => `stale evidence is excluded from readiness verdict: ${ref}`
    ),
    ...(input.supersededEvidenceRefs ?? []).map(
      (ref) => `superseded evidence is excluded from readiness verdict: ${ref}`
    )
  ];
  const ready = blockers.length === 0;

  return {
    target: input.target,
    verdict: startupVerdictForTarget(input.target, ready),
    canLaunch: ready,
    blockers,
    warnings,
    evidenceRefs,
    staleEvidenceRefs: input.staleEvidenceRefs ?? [],
    supersededEvidenceRefs: input.supersededEvidenceRefs ?? []
  };
}

export function startupVerdictReady(verdict: string): boolean {
  return [
    "local_launch_ready",
    "staging_launch_ready",
    "public_launch_ready"
  ].includes(verdict);
}

function startupVerdictForTarget(
  target: StartupVerdictTarget,
  ready: boolean
): StartupVerdict {
  if (target === "local") {
    return ready ? "local_launch_ready" : "local_launch_blocked";
  }

  if (target === "staging") {
    return ready ? "staging_launch_ready" : "staging_launch_blocked";
  }

  return ready ? "public_launch_ready" : "public_launch_blocked";
}

function missingStartupEvidenceBlockers(input: {
  target: StartupVerdictTarget;
  phases: StartupVerdictPhase[];
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
