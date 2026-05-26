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
import {
  startupSourceConnectorRequirementBlockers,
  startupSourceConnectorRequirementsForTarget
} from "../startup-source-connectors.js";
import { checkStartupGate, type StartupGateStage } from "../startup-evidence.js";
import { resolveStartupWorkerGovernance } from "../startup-founder-flow.js";
import { resolveStartupScaffoldProfile } from "../startup-scaffold-profile.js";
import { STARTUP_CONTEXT_FILE_NAMES, STALE_STARTUP_DOC_DAYS } from "./constants.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
import { inspectStartupReadyRuntimeBackend } from "./runtime-backend-phase.js";
import type {
  StartupReadyOptions,
  StartupReadyPlan,
  StartupReadyPlanPhase
} from "./types.js";
import { errorMessage, optionalStat, startupReadyStageToGateStage } from "./shared.js";
import {
  ciPlanBlockers,
  completePlanBlockers,
  deploymentPlanBlockers,
  hypothesisPlanBlockers,
  metricPlanBlockers,
  packageManagerBlockers,
  phaseIncludedForStage,
  releasePlanBlockers,
  targetOperationalEvidencePlanBlockers,
  uiPlanBlockers,
  verifierBlockers
} from "./plan-blockers.js";

export {
  ciPlanBlockers,
  completePlanBlockers,
  deploymentPlanBlockers,
  hypothesisPlanBlockers,
  metricPlanBlockers,
  packageManagerBlockers,
  phaseIncludedForStage,
  releasePlanBlockers,
  targetOperationalEvidencePlanBlockers,
  uiPlanBlockers,
  verifierBlockers
} from "./plan-blockers.js";

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
  const sourceConnectorRequirements = startupSourceConnectorRequirementsForTarget({
    target,
    env: options.sourceConnectorEnv ?? process.env
  });
  const sourceConnectorBlockers = startupSourceConnectorRequirementBlockers(
    sourceConnectorRequirements
  );
  const runtimeBackend = await inspectStartupReadyRuntimeBackend({
    cwd,
    rootPath: root.root,
    env: options.runtimeBackendEnv ?? process.env,
    live: options.runtimeBackendLive === true,
    liveMigrate: options.runtimeBackendMigrate === true,
    ...(options.runtimeBackendSchema === undefined
      ? {}
      : { schema: options.runtimeBackendSchema }),
    ...(options.runtimeBackendPostgresClientFactory === undefined
      ? {}
      : {
          postgresClientFactory: options.runtimeBackendPostgresClientFactory
        }),
    now
  });

  return {
    cwd,
    stage,
    target,
    worker,
    governanceProfile: governance.profile,
    ...(scaffoldProfile === undefined ? {} : { scaffoldProfile }),
    runsteadInitialized: root.source !== "missing",
    runtimeBackend,
    extensions: {
      discoveredPaths: extensions.discoveredPaths,
      loaded: extensions.extensions.map((extension) => extension.contract.extensionId),
      issues: extensions.issues
    },
    sourceConnectors: {
      requirements: sourceConnectorRequirements,
      blockers: sourceConnectorBlockers
    },
    phases: [
      planPhase(
        "runtime_backend",
        "Runtime backend",
        runtimeBackend.setupBlockers,
        runtimeBackend.setupBlockers.length === 0
          ? `use ${runtimeBackend.backend} runtime backend`
          : "fix runtime backend configuration before execution"
      ),
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
        ...sourceConnectorBlockers,
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
