import { join, resolve } from "node:path";

import { collectRepoInspection } from "../inspection-evidence.js";
import { resolveRunsteadRoot } from "../runstead-root.js";
import { detectStartupDevServerCommand } from "../startup-dev-server.js";
import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers,
  startupReadinessExtensionRequirementBlockers
} from "../startup-extension-loader.js";
import { checkStartupGate, type StartupGateStage } from "../startup-evidence.js";
import { resolveStartupWorkerGovernance } from "../startup-founder-flow.js";
import { resolveStartupScaffoldProfile } from "../startup-scaffold-profile.js";
import { STARTUP_CONTEXT_FILE_NAMES, STALE_STARTUP_DOC_DAYS } from "./constants.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
import type {
  StartupReadyOptions,
  StartupReadyPlan,
  StartupReadyPlanPhase,
  StartupReadyStage,
  StartupReadyTarget,
  StartupReadinessEvidenceTier
} from "./types.js";
import { errorMessage, optionalStat, startupReadyStageToGateStage } from "./shared.js";

export async function planStartupReady(
  options: StartupReadyOptions = {}
): Promise<StartupReadyPlan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? "launch";
  const target = options.target ?? "local";
  const governance = resolveStartupWorkerGovernance({
    target,
    ...(options.worker === undefined ? {} : { worker: options.worker }),
    ...(options.governanceProfile === undefined
      ? {}
      : { governanceProfile: options.governanceProfile })
  });
  const worker = governance.worker;
  const scaffoldProfile = resolveStartupScaffoldProfile({
    ...(options.appTemplate === undefined ? {} : { template: options.appTemplate }),
    ...(options.appType === undefined ? {} : { appType: options.appType })
  });
  const now = options.now ?? new Date();
  const [root, inspection, devServer, recordedEvidence, gate, docs, extensions] =
    await Promise.all([
      resolveRunsteadRoot(cwd),
      collectRepoInspection(cwd, now.toISOString()),
      inspectStartupReadyDevServer(cwd),
      collectRecordedStartupReadinessEvidence(cwd, { now }),
      inspectStartupReadyGate(cwd, startupReadyStageToGateStage(stage), now),
      inspectStartupReadyDocs(cwd, now),
      loadStartupReadinessExtensions({ cwd })
    ]);
  const evidenceTypes = new Set(recordedEvidence.evidenceTypes);
  const evidenceTiers = new Set(recordedEvidence.evidenceTiers);
  const extensionRequirements = startupReadinessExtensionEvidenceRequirements(
    extensions.extensions,
    { stage }
  );
  const extensionBlockers = startupReadinessExtensionRequirementBlockers({
    issues: extensions.issues,
    requirements: extensionRequirements,
    target,
    evidenceTiers: recordedEvidence.evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes
  });
  const extensionPolicyBlockers = startupReadinessExtensionPolicyBlockers({
    extensions: extensions.extensions,
    requirements: extensionRequirements,
    target,
    worker,
    governanceProfile: governance.profile
  });

  return {
    cwd,
    stage,
    target,
    worker,
    governanceProfile: governance.profile,
    ...(scaffoldProfile === undefined ? {} : { scaffoldProfile }),
    runsteadInitialized: root.source !== "missing",
    extensions: {
      discoveredPaths: extensions.discoveredPaths,
      loaded: extensions.extensions.map((extension) => extension.contract.extensionId),
      issues: extensions.issues
    },
    phases: [
      planPhase(
        "onboard",
        "Onboard repo",
        root.source === "missing" ? [] : [],
        root.source === "missing"
          ? "execute: initialize Runstead"
          : "ingest: use existing Runstead state"
      ),
      planPhase(
        "context",
        "Generate or ingest context",
        hypothesisPlanBlockers(evidenceTypes),
        contextPlanNextAction(docs, evidenceTypes, options.refreshContext === true)
      ),
      planPhase(
        "measurement",
        "Measurement framework",
        metricPlanBlockers(evidenceTypes),
        measurementPlanNextAction(docs, evidenceTypes, options.refreshContext === true)
      ),
      planPhase("build_mvp", "Build or repair MVP", []),
      planPhase("verifiers", "Run verifiers", [
        ...packageManagerBlockers(inspection),
        ...verifierBlockers(inspection)
      ]),
      planPhase("ui_smoke", "UI smoke", [
        ...(devServer.ok ? [] : [devServer.blocker]),
        ...uiPlanBlockers(evidenceTypes)
      ]),
      planPhase("extensions", "Extension collectors/verifiers", [
        ...extensionBlockers,
        ...extensionPolicyBlockers
      ]),
      planPhase("launch_audit", "Launch audit/security", [
        ...ciPlanBlockers(inspection, target),
        ...gate.blockers,
        ...releasePlanBlockers(evidenceTypes, target)
      ]),
      planPhase("launch_report", "Launch report", [
        ...deploymentPlanBlockers(evidenceTiers, target),
        ...targetOperationalEvidencePlanBlockers(evidenceTypes, evidenceTiers, target),
        ...extensionBlockers,
        ...extensionPolicyBlockers
      ]),
      planPhase("complete_check", "Complete product check", [
        ...gate.blockers,
        ...completePlanBlockers(evidenceTypes)
      ])
    ].filter((phase) => phaseIncludedForStage(phase.id, stage))
  };
}

export function planPhase(
  id: string,
  title: string,
  blockers: string[],
  nextAction?: string
): StartupReadyPlanPhase {
  return {
    id,
    title,
    status: blockers.length === 0 ? "pending" : "blocked",
    blockers,
    ...(nextAction === undefined ? {} : { nextAction })
  };
}

export interface StartupReadyDocsInspection {
  contextFiles: {
    existing: string[];
    stale: string[];
  };
  measurement: {
    exists: boolean;
    stale: boolean;
  };
}

export async function inspectStartupReadyDocs(
  cwd: string,
  now: Date
): Promise<StartupReadyDocsInspection> {
  const staleBefore = now.getTime() - STALE_STARTUP_DOC_DAYS * 24 * 60 * 60 * 1000;
  const context = await Promise.all(
    STARTUP_CONTEXT_FILE_NAMES.map(async (name) => {
      const path = join(cwd, name);
      const stats = await optionalStat(path);

      return stats === undefined
        ? undefined
        : {
            path,
            stale: stats.mtimeMs < staleBefore
          };
    })
  );
  const measurementStats = await optionalStat(join(cwd, "MEASUREMENT.md"));

  return {
    contextFiles: {
      existing: context
        .filter((item): item is { path: string; stale: boolean } => item !== undefined)
        .map((item) => item.path),
      stale: context
        .filter(
          (item): item is { path: string; stale: boolean } => item?.stale === true
        )
        .map((item) => item.path)
    },
    measurement: {
      exists: measurementStats !== undefined,
      stale:
        measurementStats === undefined ? false : measurementStats.mtimeMs < staleBefore
    }
  };
}

export function contextPlanNextAction(
  docs: StartupReadyDocsInspection,
  evidenceTypes: Set<string>,
  refreshContext: boolean
): string {
  if (refreshContext) {
    return "refresh: regenerate context files because --refresh-context was set";
  }

  const hasEvidence = evidenceTypes.has("startup_agent_context");

  if (docs.contextFiles.existing.length > 0 && !hasEvidence) {
    return [
      `ingest: record existing ${docs.contextFiles.existing.map((path) => path.split("/").pop()).join(", ")} as evidence`,
      docs.contextFiles.stale.length === 0
        ? "use --refresh-context to regenerate instead"
        : "stale files detected; prefer --refresh-context before launch"
    ].join("; ");
  }

  if (docs.contextFiles.stale.length > 0) {
    return "refresh recommended: context files are older than 30 days; use --refresh-context";
  }

  return hasEvidence
    ? "skip: context evidence already exists; use --refresh-context to regenerate"
    : "execute: generate AGENTS.md, CLAUDE.md, and CODEX.md";
}

export function measurementPlanNextAction(
  docs: StartupReadyDocsInspection,
  evidenceTypes: Set<string>,
  refreshContext: boolean
): string {
  if (refreshContext) {
    return "refresh: regenerate MEASUREMENT.md because --refresh-context was set";
  }

  const hasEvidence = evidenceTypes.has("startup_measurement_framework");

  if (docs.measurement.exists && !hasEvidence) {
    return docs.measurement.stale
      ? "ingest: record existing MEASUREMENT.md as evidence; stale file detected, prefer --refresh-context before launch"
      : "ingest: record existing MEASUREMENT.md as evidence; use --refresh-context to regenerate instead";
  }

  if (docs.measurement.stale) {
    return "refresh recommended: MEASUREMENT.md is older than 30 days; use --refresh-context";
  }

  return hasEvidence
    ? "skip: measurement evidence already exists; use --refresh-context to regenerate"
    : "execute: generate MEASUREMENT.md with default startup metrics";
}

export async function inspectStartupReadyDevServer(
  cwd: string
): Promise<{ ok: true; command: string } | { ok: false; blocker: string }> {
  try {
    return {
      ok: true,
      command: await detectStartupDevServerCommand(cwd)
    };
  } catch (error) {
    return {
      ok: false,
      blocker: errorMessage(error)
    };
  }
}

export async function inspectStartupReadyGate(
  cwd: string,
  stage: StartupGateStage,
  now: Date
): Promise<{ blockers: string[]; warnings: string[] }> {
  try {
    const gate = await checkStartupGate({
      cwd,
      stage,
      now,
      recordEvent: false
    });

    return {
      blockers: gate.blockers,
      warnings: gate.warnings
    };
  } catch {
    return {
      blockers: [],
      warnings: []
    };
  }
}

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
  const mvp = new Set(["onboard", "context", "measurement", "build_mvp", "verifiers"]);
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
