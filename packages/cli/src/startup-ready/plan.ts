import { resolve } from "node:path";

import { collectRepoInspection } from "../inspection-evidence.js";
import { resolveRunsteadRoot } from "../runstead-root.js";
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
import { resolveStartupWorkerGovernance } from "../startup-founder-flow.js";
import { resolveStartupScaffoldProfile } from "../startup-scaffold-profile.js";
import { collectRecordedStartupReadinessEvidence } from "./evidence.js";
import { inspectStartupReadyRuntimeBackend } from "./runtime-backend-phase.js";
import type {
  StartupReadyOptions,
  StartupReadyPlan,
  StartupReadyPlanPhase
} from "./types.js";
import { startupReadyStageToGateStage } from "./shared.js";
import {
  contextPlanNextAction,
  inspectStartupReadyDevServer,
  inspectStartupReadyDocs,
  inspectStartupReadyGate,
  measurementPlanNextAction
} from "./plan-inspection.js";
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
export {
  contextPlanNextAction,
  inspectStartupReadyDevServer,
  inspectStartupReadyDocs,
  inspectStartupReadyGate,
  measurementPlanNextAction,
  type StartupReadyDocsInspection
} from "./plan-inspection.js";

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
