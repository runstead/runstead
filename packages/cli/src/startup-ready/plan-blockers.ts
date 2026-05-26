import type { collectRepoInspection } from "../inspection-evidence.js";
import type {
  StartupReadyStage,
  StartupReadyTarget,
  StartupReadinessEvidenceTier
} from "./types.js";

export function packageManagerBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return inspection.packageManager.detected ? [] : ["package manager is missing"];
}

export function verifierBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    inspection.commands.test.detected ? undefined : "test command is missing",
    inspection.commands.lint.detected ? undefined : "lint command is missing",
    inspection.commands.typecheck.detected ? undefined : "typecheck command is missing",
    inspection.commands.build.detected ? undefined : "build command is missing"
  ].filter((blocker): blocker is string => blocker !== undefined);
}

export function hypothesisPlanBlockers(evidenceTypes: Set<string>): string[] {
  const required = [
    "startup_problem_hypothesis",
    "startup_user_hypothesis",
    "startup_solution_hypothesis"
  ];
  const missing = required.filter((type) => !evidenceTypes.has(type));

  return missing.length === 0
    ? []
    : [`hypothesis evidence is missing: ${missing.join(", ")}`];
}

export function metricPlanBlockers(evidenceTypes: Set<string>): string[] {
  return evidenceTypes.has("startup_metric") ||
    evidenceTypes.has("startup_metric_snapshot")
    ? []
    : ["metric evidence is missing"];
}

export function uiPlanBlockers(evidenceTypes: Set<string>): string[] {
  return evidenceTypes.has("startup_ui_validation")
    ? []
    : ["UI validation evidence is missing"];
}

export function ciPlanBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>,
  target: StartupReadyTarget
): string[] {
  if (target === "local") {
    return [];
  }

  return inspection.ci.providers.length === 0
    ? ["CI provider is missing for staging or production target"]
    : [];
}

export function releasePlanBlockers(
  evidenceTypes: Set<string>,
  target: StartupReadyTarget
): string[] {
  if (target === "local") {
    return [];
  }

  return [
    ...(evidenceTypes.has("startup_release_plan")
      ? []
      : ["release-plan evidence is missing"]),
    ...(target === "production" && !evidenceTypes.has("startup_rollback_plan")
      ? ["rollback-plan evidence is missing"]
      : []),
    ...(target === "production" && !evidenceTypes.has("startup_observability")
      ? ["observability evidence is missing"]
      : [])
  ];
}

export function deploymentPlanBlockers(
  evidenceTiers: Set<StartupReadinessEvidenceTier>,
  target: StartupReadyTarget
): string[] {
  if (target === "local") {
    return [];
  }

  if (target === "staging") {
    return evidenceTiers.has("staging_deployment")
      ? []
      : ["staging deployment evidence is missing"];
  }

  return evidenceTiers.has("production_deployment")
    ? []
    : ["production deployment evidence is missing"];
}

export function targetOperationalEvidencePlanBlockers(
  evidenceTypes: Set<string>,
  evidenceTiers: Set<StartupReadinessEvidenceTier>,
  target: StartupReadyTarget
): string[] {
  if (target === "local") {
    return [];
  }

  if (target === "staging") {
    return [
      ...(evidenceTypes.has("startup_rollback_drill")
        ? []
        : ["rollback-drill evidence is missing"]),
      ...(evidenceTypes.has("startup_monitoring_alerts")
        ? []
        : ["monitoring-alert evidence is missing"]),
      ...(evidenceTypes.has("startup_migration_validation")
        ? []
        : ["migration-validation evidence is missing"])
    ];
  }

  return [
    ...(evidenceTiers.has("real_user_analytics")
      ? []
      : ["real-user analytics evidence is missing"]),
    ...(evidenceTiers.has("support_ticket")
      ? []
      : ["support or feedback triage evidence is missing"]),
    ...(evidenceTiers.has("security_scan")
      ? []
      : ["security scan evidence is missing"]),
    ...(evidenceTypes.has("startup_rollback_drill")
      ? []
      : ["rollback-drill evidence is missing"]),
    ...(evidenceTypes.has("startup_monitoring_alerts")
      ? []
      : ["monitoring-alert evidence is missing"]),
    ...(evidenceTypes.has("startup_error_budget")
      ? []
      : ["error-budget evidence is missing"]),
    ...(evidenceTypes.has("startup_migration_validation")
      ? []
      : ["migration-validation evidence is missing"]),
    ...(evidenceTypes.has("startup_traffic_gate")
      ? []
      : ["real-user traffic-gate evidence is missing"]),
    ...(evidenceTypes.has("startup_post_launch_watch")
      ? []
      : ["post-launch watch evidence is missing"])
  ];
}

export function completePlanBlockers(evidenceTypes: Set<string>): string[] {
  return [
    ...(evidenceTypes.has("startup_repo_readiness")
      ? []
      : ["repo readiness evidence is missing"]),
    ...(evidenceTypes.has("startup_security_baseline")
      ? []
      : ["security baseline evidence is missing"]),
    ...(evidenceTypes.has("startup_release_plan")
      ? []
      : ["release-plan evidence is missing"])
  ];
}

export function phaseIncludedForStage(id: string, stage: StartupReadyStage): boolean {
  const mvp = new Set([
    "runtime_backend",
    "onboard",
    "context",
    "measurement",
    "build_mvp",
    "verifiers"
  ]);
  const launch = new Set([
    ...mvp,
    "ui_smoke",
    "extensions",
    "launch_audit",
    "launch_report",
    "complete_check"
  ]);
  const scale = new Set([...launch]);
  const complete = new Set([...launch]);

  if (stage === "mvp") {
    return mvp.has(id);
  }

  if (stage === "launch") {
    return launch.has(id);
  }

  if (stage === "scale") {
    return scale.has(id);
  }

  return complete.has(id);
}
