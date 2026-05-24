import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  createReadinessRunSnapshotEvent,
  readinessRunGovernanceProfile as runtimeReadinessRunGovernanceProfile,
  type ReadinessEvidenceRequirement,
  type RuntimeExecutionSemantics
} from "@runstead/runtime";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { collectRepoInspection } from "../inspection-evidence.js";
import { createLocalAgentTask, type LocalAgentWorkerKind } from "../local-agent.js";
import { recoverStaleRunningTasks } from "../resume.js";
import { requireRunsteadStateDb, resolveRunsteadRoot } from "../runstead-root.js";
import { generateStartupCiSummary } from "../startup-ci-integration.js";
import { detectStartupDevServerCommand } from "../startup-dev-server.js";
import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers,
  startupReadinessExtensionRequirementBlockers
} from "../startup-extension-loader.js";
import {
  executeStartupReadyUiSmoke,
  type StartupReadyUiSmokeCheckResult,
  type StartupReadyUiSmokeRunResult
} from "../startup-ready-ui-smoke.js";
import {
  resolveStartupScaffoldProfile,
  type StartupAppType,
  type StartupScaffoldProfile,
  type StartupScaffoldTemplate
} from "../startup-scaffold-profile.js";
import {
  formatStartupWorkerGovernanceNotice,
  resolveStartupWorkerGovernance,
  startupBuildMvp,
  startupLaunchCheck,
  startupOnboard,
  startupScaleCheck,
  type ResolvedStartupWorkerGovernanceProfile,
  type StartupBuildMvpOptions,
  type StartupFounderFlowOptions,
  type StartupWorkerGovernanceProfile
} from "../startup-founder-flow.js";
import { generateStartupCompleteProductCheck } from "../startup-complete-check.js";
import {
  addStartupEvidence,
  checkStartupGate,
  type StartupGateStage
} from "../startup-evidence.js";
import { supersedeStartupRemediationTasks } from "../startup-remediation.js";
import {
  evaluateStartupVerdict,
  type StartupVerdictResult
} from "../startup-verdict.js";
import { runTaskVerifiers, type RunTaskVerifiersResult } from "../verifier-runner.js";
import { generateStartupContext } from "../startup-automation.js";
import {
  collectCommandVerifierCodeState,
  type CommandVerifierCodeState
} from "../verifier-evidence.js";

export {
  executeStartupReadyUiSmoke,
  inferStartupReadyUiSmokeExpectText,
  inferStartupReadyUiSmokeFlowActions
} from "../startup-ready-ui-smoke.js";
export type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeCheckResult,
  StartupReadyUiSmokeConfig,
  StartupReadyUiSmokeRunResult,
  StartupReadyUiSmokeServerConfig
} from "../startup-ready-ui-smoke.js";

const STARTUP_CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];
const STALE_STARTUP_DOC_DAYS = 30;
const STARTUP_READY_APP_SURFACE_NAMES = new Set([
  "app",
  "app.js",
  "index.html",
  "main.js",
  "pages",
  "public",
  "server.js",
  "server.mjs",
  "src"
]);

export type StartupReadyStage = "mvp" | "launch" | "scale" | "complete";
export type StartupReadyTarget = "local" | "staging" | "production";
export type StartupReadinessRunStatus =
  | "planned"
  | "running"
  | "completed"
  | "blocked"
  | "failed";
export type StartupReadinessPhaseStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked"
  | "failed"
  | "skipped";
export type StartupReadinessDirtyState = "clean" | "dirty" | "unknown";
export const STARTUP_READINESS_EVIDENCE_TIERS = [
  "synthetic_smoke",
  "local_manual",
  "local_command",
  "ci_verified",
  "staging_deployment",
  "production_deployment",
  "real_user_analytics",
  "support_ticket",
  "security_scan"
] as const;

export type StartupReadinessEvidenceTier =
  (typeof STARTUP_READINESS_EVIDENCE_TIERS)[number];
export type StartupReadinessVerdict =
  | "not_evaluated"
  | "local_launch_ready"
  | "local_launch_blocked"
  | "staging_launch_ready"
  | "staging_launch_blocked"
  | "public_launch_ready"
  | "public_launch_blocked";

export interface StartupReadyOptions {
  cwd?: string;
  stage?: StartupReadyStage;
  target?: StartupReadyTarget;
  worker?: LocalAgentWorkerKind;
  governanceProfile?: StartupWorkerGovernanceProfile;
  plan?: boolean;
  resumeRunId?: string;
  writeCi?: boolean;
  ci?: boolean;
  refreshContext?: boolean;
  interactive?: boolean;
  guided?: boolean;
  interactiveAnswers?: Partial<StartupReadyInteractiveAnswers>;
  appTemplate?: StartupScaffoldTemplate;
  appType?: StartupAppType;
  maxAttempts?: number;
  forceBuild?: boolean;
  workerRunner?: StartupBuildMvpOptions["workerRunner"];
  onProgress?: (event: StartupReadyProgressEvent) => void;
  now?: Date;
}

export type StartupReadyProgressEventStatus =
  | "started"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export interface StartupReadyProgressEvent {
  runId: string;
  phaseId?: string;
  phaseTitle?: string;
  status: StartupReadyProgressEventStatus;
  message: string;
  timestamp: string;
  evidenceIds?: string[];
  artifacts?: string[];
  blockers?: string[];
}

export interface StartupReadyInteractiveAnswers {
  architecturePrinciple: string;
  technicalConstraint: string;
  acceptedDebt: string;
  activationMetric: string;
  retentionMetric: string;
  day7Metric: string;
  day30Metric: string;
  falsePositiveMetric: string;
}

export interface StartupReadyPlan {
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  scaffoldProfile?: StartupScaffoldProfile;
  runsteadInitialized: boolean;
  extensions: StartupReadyPlanExtensions;
  phases: StartupReadyPlanPhase[];
}

export interface StartupReadyPlanExtensions {
  discoveredPaths: string[];
  loaded: string[];
  issues: string[];
}

export interface StartupReadyPlanPhase {
  id: string;
  title: string;
  status: "pending" | "blocked" | "skipped";
  blockers: string[];
  nextAction?: string;
}

export interface StartupReadinessRun {
  schemaVersion: 1;
  id: string;
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  scaffoldProfile?: StartupScaffoldProfile;
  status: StartupReadinessRunStatus;
  phases: StartupReadinessRunPhase[];
  evidenceIds: string[];
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
  evidenceRequirements: ReadinessEvidenceRequirement[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
  verdict: StartupReadinessVerdict;
  verdictBlockers: string[];
  reportPaths: string[];
  guidedFlow: StartupReadyGuidedStep[];
  operatorCommands: StartupReadyOperatorCommand[];
  startedAt: string;
  completedAt?: string;
  gitHead?: string;
  dirtyState: StartupReadinessDirtyState;
  codeFingerprint?: string;
}

export interface StartupReadinessRunPhase {
  id: string;
  title: string;
  status: StartupReadinessPhaseStatus;
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
  warnings?: string[];
  execution?: RuntimeExecutionSemantics;
  nextAction?: string;
}

export type StartupReadyGuidedResolution = "runstead" | "agent" | "manual";

export interface StartupReadyGuidedStep {
  id: string;
  title: string;
  status: "ready" | "blocked" | "next";
  resolution: StartupReadyGuidedResolution;
  why: string;
  nextAction: string;
  command?: string;
  blockers: string[];
}

export type StartupReadyOperatorCommandKind =
  | "recover"
  | "resume"
  | "rerun"
  | "ci"
  | "dashboard"
  | "complete_check";

export interface StartupReadyOperatorCommand {
  kind: StartupReadyOperatorCommandKind;
  title: string;
  command: string;
  when: string;
}

export interface PersistedStartupReadinessRun {
  run: StartupReadinessRun;
  path: string;
}

export interface RunStartupReadyResult extends PersistedStartupReadinessRun {
  plan: StartupReadyPlan;
}

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

export async function runStartupReady(
  options: StartupReadyOptions = {}
): Promise<RunStartupReadyResult> {
  await recoverStartupReadyStaleTasks(options);

  const resumed =
    options.resumeRunId === undefined
      ? undefined
      : await readStartupReadinessRun({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          runId: options.resumeRunId
        });
  const plan =
    resumed === undefined
      ? await planStartupReady(options)
      : await planStartupReady({
          cwd: resumed.run.cwd,
          stage: resumed.run.stage,
          target: resumed.run.target,
          worker: resumed.run.worker,
          governanceProfile: startupReadinessRunGovernanceProfile(resumed.run),
          ...(resumed.run.scaffoldProfile?.template === undefined
            ? {}
            : { appTemplate: resumed.run.scaffoldProfile.template }),
          ...(resumed.run.scaffoldProfile?.appType === undefined
            ? {}
            : { appType: resumed.run.scaffoldProfile.appType }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
  const persisted = resumed ?? (await createStartupReadinessRun(options));
  const persistedRun = { ...persisted.run };
  delete persistedRun.completedAt;
  const run = {
    ...persistedRun,
    status: "running" as const,
    phases: persisted.run.phases.map(resetResumablePhase)
  };

  await writeStartupReadinessRun(run);
  emitStartupReadyProgress(run, options, {
    status: "started",
    message: `startup ready run started for ${run.stage}/${run.target}`
  });

  try {
    await executeStartupReadyRun(run, options);
  } catch (error) {
    const failedRun = {
      ...run,
      status: "failed" as const,
      completedAt: (options.now ?? new Date()).toISOString()
    };

    await writeStartupReadinessRun(failedRun);
    emitStartupReadyProgress(failedRun, options, {
      status: "failed",
      message: `startup ready run failed: ${errorMessage(error)}`,
      blockers: [errorMessage(error)]
    });
    throw error;
  }

  const finalRun = await finalizeRun(run, options.now ?? new Date(), {
    extraEvidenceTiers: options.ci === true ? ["ci_verified"] : []
  });
  if (isStartupReadyVerdict(finalRun.verdict)) {
    await supersedeStartupRemediationTasks({
      cwd: finalRun.cwd,
      stage: startupReadyStageToGateStage(finalRun.stage),
      activeBlockers: finalRun.verdictBlockers,
      runId: finalRun.id,
      now: options.now ?? new Date()
    });
  }
  let reportedRun = await writeStartupReadinessDecisionReport(
    finalRun,
    options.now ?? new Date()
  );

  if (options.ci === true) {
    reportedRun = await writeStartupReadinessCiOutputs(
      reportedRun,
      options.now ?? new Date()
    );
  }

  const finalPersisted = await writeStartupReadinessRun(reportedRun);
  emitStartupReadyProgress(reportedRun, options, {
    status: isStartupReadyVerdict(reportedRun.verdict) ? "completed" : "blocked",
    message: `startup ready run finished with ${reportedRun.verdict}`,
    evidenceIds: reportedRun.evidenceIds,
    artifacts: reportedRun.reportPaths,
    blockers: reportedRun.verdictBlockers
  });

  return {
    ...finalPersisted,
    plan
  };
}

async function recoverStartupReadyStaleTasks(
  options: StartupReadyOptions = {}
): Promise<void> {
  try {
    await recoverStaleRunningTasks({
      cwd: resolve(options.cwd ?? process.cwd()),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    if (!isMissingRunsteadStateError(error)) {
      throw error;
    }
  }
}

function isMissingRunsteadStateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Runstead is not initialized") ||
    message.includes("Runstead state database is missing")
  );
}

export async function createStartupReadinessRun(
  options: StartupReadyOptions = {}
): Promise<PersistedStartupReadinessRun> {
  const plan = await planStartupReady(options);
  const startedAt = (options.now ?? new Date()).toISOString();
  const codeState = await collectStartupReadyCodeState(plan.cwd);
  const run: StartupReadinessRun = {
    schemaVersion: 1,
    id: `run_${randomUUID().replaceAll("-", "")}`,
    cwd: plan.cwd,
    stage: plan.stage,
    target: plan.target,
    worker: plan.worker,
    governanceProfile: plan.governanceProfile,
    ...(plan.scaffoldProfile === undefined
      ? {}
      : { scaffoldProfile: plan.scaffoldProfile }),
    status: "planned",
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      evidenceIds: [],
      artifacts: [],
      blockers: phase.blockers,
      ...(phase.nextAction === undefined ? {} : { nextAction: phase.nextAction })
    })),
    evidenceIds: [],
    evidenceTiers: [],
    evidenceTypes: [],
    evidenceRequirements: [],
    staleEvidenceRefs: [],
    supersededEvidenceRefs: [],
    verdict: "not_evaluated",
    verdictBlockers: [],
    reportPaths: [],
    guidedFlow: [],
    operatorCommands: [],
    startedAt,
    ...(codeState.gitHead === undefined ? {} : { gitHead: codeState.gitHead }),
    dirtyState: codeState.dirtyState,
    codeFingerprint: codeState.fingerprint
  };

  return writeStartupReadinessRun(run);
}

export async function readStartupReadinessRun(input: {
  cwd?: string;
  runId: string;
}): Promise<PersistedStartupReadinessRun> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const root = await resolveRunsteadRoot(cwd);
  const path = join(startupReadinessRunsDir(root.root), `${input.runId}.json`);
  const parsed = JSON.parse(await readFile(path, "utf8")) as StartupReadinessRun;

  return {
    run: withStartupReadinessGuidance({
      ...parsed,
      evidenceRequirements: parsed.evidenceRequirements ?? [],
      staleEvidenceRefs: parsed.staleEvidenceRefs ?? [],
      supersededEvidenceRefs: parsed.supersededEvidenceRefs ?? [],
      ...(typeof parsed.codeFingerprint === "string"
        ? { codeFingerprint: parsed.codeFingerprint }
        : {}),
      governanceProfile: startupReadinessRunGovernanceProfile(parsed)
    }),
    path
  };
}

export async function writeStartupReadinessRun(
  run: StartupReadinessRun
): Promise<PersistedStartupReadinessRun> {
  const normalizedRun = withStartupReadinessGuidance(run);
  const root = await resolveRunsteadRoot(normalizedRun.cwd);
  const dir = startupReadinessRunsDir(root.root);
  const path = join(dir, `${normalizedRun.id}.json`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(normalizedRun, null, 2)}\n`, "utf8");
  await recordStartupReadinessRunSnapshot(normalizedRun, path);

  return {
    run: normalizedRun,
    path
  };
}

async function recordStartupReadinessRunSnapshot(
  run: StartupReadinessRun,
  path: string
): Promise<void> {
  let resolvedState: Awaited<ReturnType<typeof requireRunsteadStateDb>>;

  try {
    resolvedState = await requireRunsteadStateDb(run.cwd);
  } catch {
    return;
  }

  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: createReadinessRunSnapshotEvent(run, { path })
    });
  } finally {
    database.close();
  }
}

function startupReadinessRunGovernanceProfile(
  run: Pick<StartupReadinessRun, "worker"> & {
    governanceProfile?: ResolvedStartupWorkerGovernanceProfile;
  }
): ResolvedStartupWorkerGovernanceProfile {
  const profile = runtimeReadinessRunGovernanceProfile(run);

  return profile === "governed" ? "governed" : "readiness";
}

export function formatStartupReadyPlan(plan: StartupReadyPlan): string {
  return [
    "Startup readiness plan",
    `Workspace: ${plan.cwd}`,
    `Stage: ${plan.stage}`,
    `Target: ${plan.target}`,
    `Worker: ${plan.worker}`,
    `Governance profile: ${plan.governanceProfile}`,
    formatStartupWorkerGovernanceNotice(plan.worker, plan.governanceProfile),
    ...(plan.scaffoldProfile === undefined
      ? []
      : [
          `Scaffold profile: ${plan.scaffoldProfile.id} (${plan.scaffoldProfile.title})`
        ]),
    `Runstead initialized: ${plan.runsteadInitialized ? "yes" : "no"}`,
    `Extensions: ${
      plan.extensions.loaded.length === 0 ? "none" : plan.extensions.loaded.join(", ")
    }`,
    ...(plan.extensions.issues.length === 0
      ? []
      : plan.extensions.issues.map((issue) => `Extension issue: ${issue}`)),
    "",
    "Phases:",
    ...plan.phases.flatMap((phase, index) => [
      `${index + 1}. ${phase.title}: ${phase.status}${phase.blockers.length === 0 ? "" : ` (${phase.blockers.join("; ")})`}`,
      ...(phase.nextAction === undefined ? [] : [`   next: ${phase.nextAction}`])
    ])
  ].join("\n");
}

export function formatStartupReadinessRun(run: StartupReadinessRun): string {
  const decisions = startupReadinessDecisionMatrix(run);
  const orderedDecisions = [
    decisions.localDemo,
    decisions.privateBeta,
    decisions.publicLaunch
  ];
  const requestedDecision = orderedDecisions.find(
    (decision) => decision.target === run.target
  );
  const guidedFlow =
    run.guidedFlow.length === 0 ? buildStartupReadyGuidedFlow(run) : run.guidedFlow;
  const operatorCommands =
    run.operatorCommands.length === 0
      ? buildStartupReadyOperatorCommands(run)
      : run.operatorCommands;

  return [
    `Runstead startup readiness run: ${run.id}`,
    `Worker: ${run.worker}`,
    `Governance profile: ${startupReadinessRunGovernanceProfile(run)}`,
    formatStartupWorkerGovernanceNotice(
      run.worker,
      startupReadinessRunGovernanceProfile(run)
    ),
    ...(run.scaffoldProfile === undefined
      ? []
      : [`Scaffold profile: ${run.scaffoldProfile.id} (${run.scaffoldProfile.title})`]),
    "",
    ...run.phases.map(
      (phase, index) => `${index + 1}. ${phase.title.padEnd(28)} ${phase.status}`
    ),
    "",
    `Status: ${run.status}`,
    `Target: ${run.target}`,
    `Verdict: ${run.verdict}`,
    `Evidence tiers: ${run.evidenceTiers.length === 0 ? "none" : run.evidenceTiers.join(", ")}`,
    `Evidence types: ${run.evidenceTypes.length === 0 ? "none" : run.evidenceTypes.join(", ")}`,
    `Verdict blockers: ${run.verdictBlockers.length === 0 ? "none" : run.verdictBlockers.join("; ")}`,
    `Git head: ${run.gitHead ?? "unknown"}`,
    `Dirty state: ${run.dirtyState}`,
    `Code fingerprint: ${run.codeFingerprint ?? "unknown"}`,
    "",
    "Launch decision:",
    `- Requested target: ${run.target} ${requestedDecision?.canLaunch === true ? "ready" : "blocked"} (${run.verdict})`,
    ...orderedDecisions.map(
      (decision) =>
        `- ${decision.title}: ${decision.canLaunch ? "yes" : "no"} (${decision.nextAction})`
    ),
    "",
    "Target boundary:",
    ...formatStartupReadinessTargetBoundaryLines(
      startupReadinessTargetBoundary(run.target)
    ),
    "",
    "Guided readiness flow:",
    ...formatStartupReadyGuidedFlowLines(guidedFlow),
    "",
    "Operator commands:",
    ...formatStartupReadyOperatorCommandLines(operatorCommands),
    "",
    "Evidence summary:",
    `- Phase evidence refs: ${run.evidenceIds.length}`,
    `- Evidence tiers: ${run.evidenceTiers.length === 0 ? "none" : run.evidenceTiers.join(", ")}`,
    `- Evidence types: ${run.evidenceTypes.length === 0 ? "none" : run.evidenceTypes.join(", ")}`,
    "",
    "Reports:",
    run.reportPaths.length === 0
      ? "- none"
      : run.reportPaths.map((path) => `- ${path}`).join("\n")
  ].join("\n");
}

export function formatStartupReadyProgress(event: StartupReadyProgressEvent): string {
  const scope =
    event.phaseTitle === undefined
      ? "run"
      : `${event.phaseTitle} (${event.phaseId ?? "phase"})`;
  const details = [
    `[startup ready] ${scope}: ${event.status}`,
    event.message,
    ...(event.blockers === undefined || event.blockers.length === 0
      ? []
      : [`blockers=${event.blockers.length}`]),
    ...(event.evidenceIds === undefined || event.evidenceIds.length === 0
      ? []
      : [`evidence=${event.evidenceIds.length}`]),
    ...(event.artifacts === undefined || event.artifacts.length === 0
      ? []
      : [`artifacts=${event.artifacts.length}`])
  ];

  return details.join(" | ");
}

async function executeStartupReadyRun(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  const interactiveAnswers = await collectStartupReadyInteractiveAnswers(options);

  if (
    shouldRunPhase(run, "onboard") ||
    shouldRunPhase(run, "context") ||
    shouldRunPhase(run, "measurement")
  ) {
    updatePhase(run, "onboard", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "onboard",
      status: "started",
      message: "initializing Runstead startup context and measurement"
    });
    const onboard = await startupOnboard({
      cwd: run.cwd,
      writeCi: options.writeCi === true,
      force: options.refreshContext === true,
      ...startupReadyInteractiveFounderFlowOptions(interactiveAnswers),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    updatePhase(run, "onboard", {
      status: "passed",
      artifacts: [
        ...onboard.onboardingFiles,
        ...(onboard.repo.ci.path === undefined ? [] : [onboard.repo.ci.path])
      ]
    });
    updatePhase(run, "context", {
      status: onboard.context.status === "generated" ? "passed" : "skipped",
      evidenceIds:
        onboard.context.result === undefined ? [] : [onboard.context.result.evidenceId],
      artifacts: onboard.context.result?.files ?? [],
      blockers:
        onboard.context.status === "generated"
          ? []
          : [onboard.context.reason ?? "context generation skipped"]
    });
    updatePhase(run, "measurement", {
      status: onboard.measurement.status === "generated" ? "passed" : "skipped",
      evidenceIds:
        onboard.measurement.result === undefined
          ? []
          : [onboard.measurement.result.evidenceId],
      artifacts: onboard.measurement.result?.files ?? [],
      blockers:
        onboard.measurement.status === "generated"
          ? []
          : [onboard.measurement.reason ?? "measurement generation skipped"]
    });
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "onboard");
    emitStartupReadyPhaseResult(run, options, "context");
    emitStartupReadyPhaseResult(run, options, "measurement");
  }

  if (run.target === "local" && hasPhase(run, "build_mvp")) {
    await ensureStartupReadyLocalMvpEvidence(run, options.now ?? new Date());
  }

  if (shouldRunPhase(run, "build_mvp") || shouldRunPhase(run, "verifiers")) {
    const greenPath = await startupReadyGreenPathPreflight(run, options);

    updatePhase(run, "build_mvp", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "build_mvp",
      status: "started",
      message: greenPath.ok
        ? "verifying existing MVP without starting an agent worker"
        : "running bounded MVP build or repair loop"
    });
    const scaffoldArtifact =
      run.scaffoldProfile === undefined
        ? undefined
        : await writeStartupScaffoldProfileArtifact(run);
    const build = await executeStartupReadyMvpBuild({
      run,
      options,
      greenPath
    });
    const verifierPhase = await startupReadyVerifierPhaseUpdate(run, build, options);
    const initialBuildPhaseStatus = startupBuildMvpPhaseExecutionStatus(
      build.status,
      build.execution
    );
    const buildRecovery = startupReadyAutoRecoverBuildMvp({
      status: initialBuildPhaseStatus,
      execution: build.execution,
      verifierPhase: verifierPhase.update
    });
    const buildPhaseStatus = buildRecovery.status;
    const buildExecution = buildRecovery.execution;
    const buildWarnings = startupBuildMvpPhaseExecutionWarnings(buildExecution, {
      verifiedByCurrentEvidence: verifierPhase.verifiedByCurrentEvidence,
      verifierOnlyRecovery: buildRecovery.recovered
    });

    updatePhase(run, "build_mvp", {
      status: buildPhaseStatus,
      execution: buildExecution,
      warnings: buildWarnings,
      artifacts: scaffoldArtifact === undefined ? [] : [scaffoldArtifact],
      blockers:
        buildPhaseStatus === "passed"
          ? build.gate.blockers
          : [`worker finished with status ${build.status}`],
      nextAction:
        buildPhaseStatus === "passed"
          ? build.agentSkipped
            ? "existing MVP verified; skipped worker build"
            : buildRecovery.recovered
              ? "Runstead recovered without re-running the agent; current verifier evidence proves the MVP"
            : buildWarnings.length > 0
              ? "verified MVP despite worker completion warning; continue launch readiness"
              : build.status === "completed_with_warnings"
                ? "review MVP worker warnings and continue launch readiness"
                : "review MVP gate blockers and continue launch readiness"
          : verifierPhase.update.status === "passed"
            ? "Runstead can recover without re-running the agent; resume this readiness run for verifier-only evaluation"
            : "review worker output and resume startup readiness"
    });
    updatePhase(run, "verifiers", verifierPhase.update);
    await refreshStartupReadyCurrentContext(run, options);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "build_mvp");
    emitStartupReadyPhaseResult(run, options, "verifiers");
  }

  if (shouldRunPhase(run, "ui_smoke")) {
    updatePhase(run, "ui_smoke", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "ui_smoke",
      status: "started",
      message: "running local UI smoke checks"
    });
    let uiSmoke = await executeStartupReadyUiSmoke({
      cwd: run.cwd,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const uiSmokeRepair =
      uiSmoke.status === "blocked"
        ? await attemptStartupReadyUiSmokeRepair(run, options, uiSmoke)
        : undefined;

    if (uiSmokeRepair !== undefined) {
      uiSmoke = uiSmokeRepair.uiSmoke;

      if (uiSmokeRepair.verifierUpdate !== undefined) {
        updatePhase(run, "verifiers", uiSmokeRepair.verifierUpdate);
      }
    }

    updatePhase(run, "ui_smoke", {
      status: uiSmoke.status,
      evidenceIds: uiSmoke.evidenceIds,
      artifacts: unique([...(uiSmokeRepair?.artifacts ?? []), ...uiSmoke.artifacts]),
      blockers:
        uiSmoke.status === "passed"
          ? []
          : unique([...(uiSmokeRepair?.blockers ?? []), ...uiSmoke.blockers]),
      nextAction:
        uiSmoke.status === "passed"
          ? uiSmokeRepair === undefined
            ? "continue launch readiness"
            : "automatic UI smoke repair passed; continue launch readiness"
          : uiSmokeRepair === undefined
            ? "fix UI smoke config or product flow and rerun startup ready"
            : "automatic UI smoke repair attempted; review repair artifact or resume startup ready"
    });
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "ui_smoke");
  }

  if (run.target === "local" && hasPhase(run, "launch_audit")) {
    await ensureStartupReadyLocalLaunchEvidence(run, options.now ?? new Date());
  }

  if (shouldRunPhase(run, "launch_audit") || shouldRunPhase(run, "launch_report")) {
    updatePhase(run, "launch_audit", { status: "running" });
    updatePhase(run, "launch_report", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "launch_audit",
      status: "started",
      message: "running launch audit and security checks"
    });
    emitStartupReadyProgress(run, options, {
      phaseId: "launch_report",
      status: "started",
      message: "building launch readiness report"
    });
    const launch = await startupLaunchCheck({
      cwd: run.cwd,
      target: run.target,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const auditBlockers = [...launch.readiness.blockers, ...launch.security.blockers];

    updatePhase(run, "launch_audit", {
      status: auditBlockers.length === 0 ? "passed" : "blocked",
      evidenceIds: [launch.readiness.evidenceId, launch.security.evidenceId],
      artifacts: [...launch.readiness.files, ...launch.security.files],
      blockers: auditBlockers
    });
    updatePhase(run, "launch_report", {
      status: launch.status === "launch_ready" ? "passed" : "blocked",
      artifacts: [launch.reportPath],
      blockers: launch.blockers,
      nextAction:
        launch.status === "launch_ready"
          ? "run scale or complete readiness"
          : "resolve launch blockers and rerun startup ready"
    });
    run.reportPaths = unique([...run.reportPaths, launch.reportPath]);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "launch_audit");
    emitStartupReadyPhaseResult(run, options, "launch_report");
  }

  if (run.stage === "scale") {
    await startupScaleCheck({
      cwd: run.cwd,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  if (shouldRunPhase(run, "complete_check")) {
    updatePhase(run, "complete_check", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "complete_check",
      status: "started",
      message: "running complete product readiness check"
    });
    const provisional = await finalizeRun(run, options.now ?? new Date());
    const complete = await generateStartupCompleteProductCheck({
      cwd: run.cwd,
      target: run.target,
      readiness: {
        verdict: provisional.verdict,
        blockers: provisional.verdictBlockers
      },
      ...(options.now === undefined ? {} : { now: options.now })
    });

    const completeArtifacts = startupCompleteProductArtifacts(complete);

    updatePhase(run, "complete_check", {
      status: complete.status === "complete" ? "passed" : "blocked",
      evidenceIds: [complete.evidenceId],
      artifacts: completeArtifacts,
      blockers: complete.criteria.flatMap((criterion) => criterion.missing),
      nextAction:
        complete.status === "complete"
          ? "ship with recorded evidence"
          : "resolve complete-product missing evidence and rerun startup ready"
    });
    run.reportPaths = unique([...run.reportPaths, ...completeArtifacts]);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "complete_check");
  }
}

interface StartupReadyUiSmokeRepairAttempt {
  uiSmoke: StartupReadyUiSmokeRunResult;
  artifacts: string[];
  blockers: string[];
  verifierUpdate?: Partial<StartupReadinessRunPhase>;
}

interface StartupReadyMvpBuildExecution {
  status: StartupBuildMvpResultStatus;
  execution: RuntimeExecutionSemantics;
  verifierRun: StartupMvpVerifierRun;
  gate: Awaited<ReturnType<typeof checkStartupGate>>;
  agentSkipped: boolean;
}

interface StartupReadyGreenPathPreflight {
  ok: boolean;
  blockers: string[];
}

type StartupMvpVerifierRun = Awaited<ReturnType<typeof startupBuildMvp>>["verifierRun"];

function startupCompleteProductArtifacts(
  complete: Awaited<ReturnType<typeof generateStartupCompleteProductCheck>>
): string[] {
  return unique([
    complete.markdownPath,
    complete.jsonPath,
    complete.surfaces.launchReportMarkdown,
    complete.surfaces.launchReportJson,
    complete.surfaces.ciMarkdown,
    complete.surfaces.ciJson,
    complete.surfaces.dashboardHtml,
    complete.surfaces.dashboardJson,
    complete.surfaces.diagnosticsMarkdown,
    complete.surfaces.diagnosticsJson
  ]);
}

async function writeStartupScaffoldProfileArtifact(
  run: StartupReadinessRun
): Promise<string | undefined> {
  if (run.scaffoldProfile === undefined) {
    return undefined;
  }

  const root = await resolveRunsteadRoot(run.cwd);
  const path = join(root.root, "startup", "scaffold-profile.json");

  await mkdir(join(root.root, "startup"), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: run.id,
        target: run.target,
        worker: run.worker,
        profile: run.scaffoldProfile
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return path;
}

async function executeStartupReadyMvpBuild(input: {
  run: StartupReadinessRun;
  options: StartupReadyOptions;
  greenPath: StartupReadyGreenPathPreflight;
}): Promise<StartupReadyMvpBuildExecution> {
  if (input.greenPath.ok) {
    const verified = await runStartupReadyGreenPathVerifiers(input.run, input.options);

    if (startupMvpVerifierRunPassed(verified.verifierRun)) {
      return {
        status: "completed",
        execution: {
          implementation: "no_change_needed",
          verification: "passed",
          agentCompletion: "completed"
        },
        verifierRun: verified.verifierRun,
        gate: await checkStartupGate({
          cwd: input.run.cwd,
          stage: "mvp",
          ...(input.options.now === undefined ? {} : { now: input.options.now })
        }),
        agentSkipped: true
      };
    }
  }

  const build = await startupBuildMvp({
    cwd: input.run.cwd,
    worker: input.run.worker,
    dependencyPolicy: "deny-new",
    maxAttempts: input.options.maxAttempts ?? 2,
    ...(input.run.scaffoldProfile === undefined
      ? {}
      : { scaffoldProfile: input.run.scaffoldProfile }),
    ...(input.options.workerRunner === undefined
      ? {}
      : { workerRunner: input.options.workerRunner }),
    ...(input.options.now === undefined ? {} : { now: input.options.now })
  });

  return {
    status: build.status,
    execution: build.execution,
    verifierRun: build.verifierRun,
    gate: build.gate,
    agentSkipped: false
  };
}

async function startupReadyGreenPathPreflight(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<StartupReadyGreenPathPreflight> {
  if (options.forceBuild === true) {
    return {
      ok: false,
      blockers: ["force build requested"]
    };
  }

  const [inspection, hasAppSurface, hasUiSmokeConfig] = await Promise.all([
    collectRepoInspection(run.cwd, (options.now ?? new Date()).toISOString()),
    hasStartupReadyApplicationSurface(run.cwd),
    hasStartupReadyUiSmokeConfig(run)
  ]);
  const blockers = [
    hasAppSurface ? undefined : "application surface is missing",
    inspection.commands.test.detected ? undefined : "test command is missing",
    inspection.commands.lint.detected ? undefined : "lint command is missing",
    inspection.commands.typecheck.detected ? undefined : "typecheck command is missing",
    inspection.commands.build.detected ? undefined : "build command is missing",
    hasPhase(run, "ui_smoke") && !hasUiSmokeConfig
      ? "UI smoke config is missing"
      : undefined
  ].filter((blocker): blocker is string => blocker !== undefined);

  return {
    ok: blockers.length === 0,
    blockers
  };
}

async function runStartupReadyGreenPathVerifiers(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<{ verifierRun: StartupMvpVerifierRun }> {
  const created = await createLocalAgentTask({
    cwd: run.cwd,
    title: "Verify existing startup MVP",
    prompt:
      "Verify the existing AI-coded MVP with repository commands. Do not invoke an editing agent.",
    worker: run.worker,
    mode: "read-only",
    verifierCommands: await startupReadyVerifierCommands(run.cwd, options.now),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const verified = await runTaskVerifiers({
    cwd: run.cwd,
    taskId: created.task.id,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    verifierRun: startupMvpVerifierRunFromTaskVerifiers(verified)
  };
}

async function startupReadyVerifierCommands(
  cwd: string,
  now?: Date
): Promise<{ name: string; command: string }[]> {
  const inspection = await collectRepoInspection(
    cwd,
    (now ?? new Date()).toISOString()
  );

  return [
    { name: "test", command: inspection.commands.test.command },
    { name: "lint", command: inspection.commands.lint.command },
    { name: "typecheck", command: inspection.commands.typecheck.command },
    { name: "build", command: inspection.commands.build.command }
  ].flatMap((item) =>
    item.command === undefined ? [] : [{ name: item.name, command: item.command }]
  );
}

function startupMvpVerifierRunFromTaskVerifiers(
  result: RunTaskVerifiersResult
): StartupMvpVerifierRun {
  const failed = result.commandResults.some(
    (command) => command.exitCode !== 0 || command.timedOut
  );

  return {
    status: failed ? "failed" : "completed",
    taskId: result.task.id,
    commandResults: result.commandResults
  };
}

function startupMvpVerifierRunPassed(run: StartupMvpVerifierRun): boolean {
  return (
    run.status === "completed" &&
    run.commandResults.length > 0 &&
    run.commandResults.every(
      (command) => command.exitCode === 0 && command.timedOut === false
    )
  );
}

async function hasStartupReadyUiSmokeConfig(
  run: StartupReadinessRun
): Promise<boolean> {
  if (!hasPhase(run, "ui_smoke")) {
    return true;
  }

  const root = await resolveRunsteadRoot(run.cwd);

  return (
    (await optionalStat(join(root.root, "startup", "ui-smoke.yaml"))) !== undefined
  );
}

async function hasStartupReadyApplicationSurface(cwd: string): Promise<boolean> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true });

    return entries.some((entry) => STARTUP_READY_APP_SURFACE_NAMES.has(entry.name));
  } catch {
    return false;
  }
}

async function refreshStartupReadyCurrentContext(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (!hasPhase(run, "context")) {
    return;
  }

  const refreshed = await generateStartupContext({
    cwd: run.cwd,
    currentOnly: true,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const current = run.phases.find((phase) => phase.id === "context");
  const status = current?.status === "pending" ? "passed" : current?.status;

  updatePhase(run, "context", {
    ...(status === undefined ? {} : { status }),
    evidenceIds: unique([...(current?.evidenceIds ?? []), refreshed.evidenceId]),
    artifacts: unique([
      ...(current?.artifacts ?? []),
      ...refreshed.files,
      ...refreshed.structuredFiles
    ]),
    blockers: current?.status === "blocked" ? current.blockers : []
  });
}

async function attemptStartupReadyUiSmokeRepair(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  uiSmoke: StartupReadyUiSmokeRunResult
): Promise<StartupReadyUiSmokeRepairAttempt | undefined> {
  const target = startupReadyUiSmokeRepairTarget(uiSmoke);

  if (target === undefined) {
    return undefined;
  }

  const repairArtifact = await writeStartupReadyUiSmokeRepairRequest({
    run,
    uiSmoke,
    target,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  emitStartupReadyProgress(run, options, {
    phaseId: "ui_smoke",
    status: "started",
    message: "attempting automatic UI smoke repair with bounded MVP repair loop",
    artifacts: [repairArtifact]
  });

  const build = await startupBuildMvp({
    cwd: run.cwd,
    worker: run.worker,
    dependencyPolicy: "deny-new",
    maxAttempts: 1,
    ...(run.scaffoldProfile === undefined
      ? {}
      : { scaffoldProfile: run.scaffoldProfile }),
    prompt: startupReadyUiSmokeRepairPrompt({
      run,
      uiSmoke,
      target,
      repairArtifact
    }),
    ...(options.workerRunner === undefined
      ? {}
      : { workerRunner: options.workerRunner }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const verifierUpdate = verifierPhaseUpdate(build.verifierRun);
  const repaired =
    startupBuildMvpPhaseExecutionStatus(build.status, build.execution) === "passed" &&
    verifierUpdate.status === "passed";
  const rerun = repaired
    ? await executeStartupReadyUiSmoke({
        cwd: run.cwd,
        ...(options.now === undefined ? {} : { now: options.now })
      })
    : uiSmoke;

  return {
    uiSmoke: rerun,
    artifacts: unique([...uiSmoke.artifacts, repairArtifact]),
    blockers: repaired
      ? []
      : [
          `automatic UI smoke repair did not produce a verified repair: worker=${build.status}; verifiers=${build.verifierRun.status}`
        ],
    verifierUpdate: mergeStartupVerifierPhaseUpdate(run, verifierUpdate)
  };
}

function startupReadyUiSmokeRepairTarget(
  uiSmoke: StartupReadyUiSmokeRunResult
): StartupReadyUiSmokeCheckResult | undefined {
  return uiSmoke.checks.find((check) => {
    if (check.status !== "failed") {
      return false;
    }

    return (
      check.failureCategory !== "browser_runtime" && check.failureCategory !== "network"
    );
  });
}

async function writeStartupReadyUiSmokeRepairRequest(input: {
  run: StartupReadinessRun;
  uiSmoke: StartupReadyUiSmokeRunResult;
  target: StartupReadyUiSmokeCheckResult;
  now?: Date;
}): Promise<string> {
  const root = await resolveRunsteadRoot(input.run.cwd);
  const dir = join(root.root, "startup");
  const path = join(dir, `ui-smoke-repair-${input.run.id}.json`);

  await mkdir(dir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: input.run.id,
        phase: "ui_smoke",
        configPath: input.uiSmoke.configPath,
        check: input.target.name,
        failureCategory: input.target.failureCategory ?? "unknown",
        failureSummary: input.target.failureSummary ?? "unknown",
        failedAction: input.target.failedAction ?? null,
        domArtifact: input.target.artifact ?? null,
        repairHint: input.target.repairHint ?? null,
        generatedAt: (input.now ?? new Date()).toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return path;
}

function startupReadyUiSmokeRepairPrompt(input: {
  run: StartupReadinessRun;
  uiSmoke: StartupReadyUiSmokeRunResult;
  target: StartupReadyUiSmokeCheckResult;
  repairArtifact: string;
}): string {
  return [
    "Repair the product or UI smoke configuration for a failed Runstead UI smoke check.",
    "Keep the patch scoped to the failing UI flow. Do not add or upgrade dependencies.",
    "Prefer stable product selectors such as data-testid for core todo interactions.",
    "",
    `Run: ${input.run.id}`,
    `UI smoke config: ${input.uiSmoke.configPath}`,
    `Repair artifact: ${input.repairArtifact}`,
    `Check: ${input.target.name}`,
    `Failure category: ${input.target.failureCategory ?? "unknown"}`,
    `Failure summary: ${input.target.failureSummary ?? "unknown"}`,
    `DOM snapshot artifact: ${input.target.artifact ?? "unavailable"}`,
    `Repair hint: ${input.target.repairHint ?? "none"}`,
    "",
    "Failed action:",
    JSON.stringify(input.target.failedAction ?? null, null, 2),
    "",
    "After applying the smallest repair, leave test/lint/typecheck/build verifiers green. Runstead will rerun UI smoke automatically."
  ].join("\n");
}

function mergeStartupVerifierPhaseUpdate(
  run: StartupReadinessRun,
  update: Partial<StartupReadinessRunPhase>
): Partial<StartupReadinessRunPhase> {
  const current = run.phases.find((phase) => phase.id === "verifiers");

  return {
    ...update,
    evidenceIds: unique([
      ...(current?.evidenceIds ?? []),
      ...(update.evidenceIds ?? [])
    ]),
    artifacts: unique([...(current?.artifacts ?? []), ...(update.artifacts ?? [])]),
    blockers:
      update.status === "passed"
        ? []
        : unique([...(current?.blockers ?? []), ...(update.blockers ?? [])])
  };
}

function emitStartupReadyPhaseResult(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  phaseId: string
): void {
  const phase = run.phases.find((item) => item.id === phaseId);

  if (phase === undefined) {
    return;
  }

  emitStartupReadyProgress(run, options, {
    phaseId,
    status: startupReadyProgressStatusForPhase(phase.status),
    message: `${phase.title} ${phase.status}`,
    evidenceIds: phase.evidenceIds,
    artifacts: phase.artifacts,
    blockers: phase.blockers
  });
}

function emitStartupReadyProgress(
  run: StartupReadinessRun,
  options: StartupReadyOptions,
  event: Omit<StartupReadyProgressEvent, "runId" | "timestamp" | "phaseTitle">
): void {
  const phase =
    event.phaseId === undefined
      ? undefined
      : run.phases.find((item) => item.id === event.phaseId);

  options.onProgress?.({
    runId: run.id,
    ...(event.phaseId === undefined ? {} : { phaseId: event.phaseId }),
    ...(phase === undefined ? {} : { phaseTitle: phase.title }),
    status: event.status,
    message: event.message,
    timestamp: (options.now ?? new Date()).toISOString(),
    ...(event.evidenceIds === undefined ? {} : { evidenceIds: event.evidenceIds }),
    ...(event.artifacts === undefined ? {} : { artifacts: event.artifacts }),
    ...(event.blockers === undefined ? {} : { blockers: event.blockers })
  });
}

function startupReadyProgressStatusForPhase(
  status: StartupReadinessPhaseStatus
): StartupReadyProgressEventStatus {
  if (status === "passed") {
    return "completed";
  }

  if (status === "blocked") {
    return "blocked";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "skipped") {
    return "skipped";
  }

  return "started";
}

async function collectStartupReadyInteractiveAnswers(
  options: StartupReadyOptions
): Promise<Partial<StartupReadyInteractiveAnswers>> {
  const provided = normalizeStartupReadyInteractiveAnswers(options.interactiveAnswers);

  if (options.interactive !== true) {
    return provided;
  }

  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    if (Object.keys(provided).length > 0) {
      return provided;
    }

    throw new Error(
      "--interactive startup ready requires a TTY; omit --interactive for default answers"
    );
  }

  const prompts = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    return normalizeStartupReadyInteractiveAnswers({
      architecturePrinciple:
        provided.architecturePrinciple ??
        (await promptStartupReadyAnswer(
          prompts,
          "Architecture principle to add to agent context"
        )),
      technicalConstraint:
        provided.technicalConstraint ??
        (await promptStartupReadyAnswer(
          prompts,
          "Technical constraint to add to agent context"
        )),
      acceptedDebt:
        provided.acceptedDebt ??
        (await promptStartupReadyAnswer(prompts, "Accepted technical debt to record")),
      activationMetric:
        provided.activationMetric ??
        (await promptStartupReadyAnswer(prompts, "Activation metric")),
      retentionMetric:
        provided.retentionMetric ??
        (await promptStartupReadyAnswer(prompts, "Retention metric")),
      day7Metric:
        provided.day7Metric ??
        (await promptStartupReadyAnswer(prompts, "Day 7 metric")),
      day30Metric:
        provided.day30Metric ??
        (await promptStartupReadyAnswer(prompts, "Day 30 metric")),
      falsePositiveMetric:
        provided.falsePositiveMetric ??
        (await promptStartupReadyAnswer(prompts, "False-positive control metric"))
    });
  } finally {
    prompts.close();
  }
}

async function promptStartupReadyAnswer(
  prompts: ReturnType<typeof createInterface>,
  label: string
): Promise<string | undefined> {
  const answer = (await prompts.question(`${label}: `)).trim();

  return answer.length === 0 ? undefined : answer;
}

function normalizeStartupReadyInteractiveAnswers(
  answers:
    | Partial<Record<keyof StartupReadyInteractiveAnswers, string | undefined>>
    | undefined
): Partial<StartupReadyInteractiveAnswers> {
  if (answers === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(answers)
      .map(([key, value]) => [key, stringValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  );
}

function startupReadyInteractiveFounderFlowOptions(
  answers: Partial<StartupReadyInteractiveAnswers>
): Pick<
  StartupFounderFlowOptions,
  | "architecturePrinciples"
  | "technicalConstraints"
  | "acceptedDebt"
  | "activationMetric"
  | "retentionMetric"
  | "day7Metric"
  | "day30Metric"
  | "falsePositiveMetric"
> {
  return {
    ...optionalSingleValueArray(
      "architecturePrinciples",
      answers.architecturePrinciple
    ),
    ...optionalSingleValueArray("technicalConstraints", answers.technicalConstraint),
    ...optionalSingleValueArray("acceptedDebt", answers.acceptedDebt),
    ...optionalStringField("activationMetric", answers.activationMetric),
    ...optionalStringField("retentionMetric", answers.retentionMetric),
    ...optionalStringField("day7Metric", answers.day7Metric),
    ...optionalStringField("day30Metric", answers.day30Metric),
    ...optionalStringField("falsePositiveMetric", answers.falsePositiveMetric)
  };
}

function optionalSingleValueArray<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string[]>> {
  return value === undefined ? {} : ({ [key]: [value] } as Record<K, string[]>);
}

function optionalStringField<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

async function ensureStartupReadyLocalMvpEvidence(
  run: StartupReadinessRun,
  now: Date
): Promise<void> {
  const evidenceTypes = new Set(
    (await collectRecordedStartupReadinessEvidence(run.cwd, { now })).evidenceTypes
  );
  const gate = await checkStartupGate({
    cwd: run.cwd,
    stage: "mvp",
    now,
    recordEvent: false
  });

  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "problem_hypothesis",
    summary:
      "local_manual startup ready baseline: local MVP needs evidence-backed verification before launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "problem_hypothesis",
      statement:
        "A locally generated MVP can look complete even when launch evidence, verifiers, and UI smoke are missing.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "problem hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "user_hypothesis",
    summary:
      "local_manual startup ready baseline: founder-builders are validating this repo for local launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "user_hypothesis",
      persona: "founder-builder",
      statement:
        "A founder-builder needs a short local path from agent build to verifiers, UI smoke, launch report, and gate verdict.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "user hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "solution_hypothesis",
    summary:
      "local_manual startup ready baseline: Runstead local readiness can verify the MVP with scripted evidence.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      kind: "solution_hypothesis",
      statement:
        "A local launch-ready MVP should pass repository verifiers, UI smoke, launch audit, launch report, and complete-check.",
      status: "validated",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "solution hypothesis is missing")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "disconfirming",
    summary:
      "local_manual startup ready baseline: no blocker-level local disconfirming signal is recorded yet; real-user evidence is still required beyond local launch.",
    sourceRefs: [`startup-ready:${run.id}:local-baseline`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      signalsReviewed: ["local repository inspection", "planned verifier run"],
      blockerSignalFound: false,
      limitation:
        "This baseline does not replace customer interviews, real-user analytics, staging traffic, or production support evidence.",
      confidence: "local_manual"
    },
    gate: "mvp",
    now,
    force: gateNeedsBaselineEvidence(gate.blockers, "disconfirming evidence is missing")
  });
}

async function ensureStartupReadyLocalLaunchEvidence(
  run: StartupReadinessRun,
  now: Date
): Promise<void> {
  if (phaseStatus(run, "verifiers") !== "passed") {
    return;
  }

  if (hasPhase(run, "ui_smoke") && phaseStatus(run, "ui_smoke") !== "passed") {
    return;
  }

  const evidenceTypes = new Set(
    (await collectRecordedStartupReadinessEvidence(run.cwd, { now })).evidenceTypes
  );
  const gate = await checkStartupGate({
    cwd: run.cwd,
    stage: "launch",
    now,
    recordEvent: false
  });

  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "metric_snapshot",
    summary:
      "local_command startup ready metric snapshot: required local verifiers and UI smoke are passing.",
    sourceRefs: [`startup-ready:${run.id}:verifiers`],
    sources: [localStartupReadySource(run.id, now, "local_command")],
    content: {
      source: "startup_ready_local_verifiers",
      threshold: 1,
      current: 1,
      metric: "local_required_checks_passed",
      sourceClass: "synthetic_smoke",
      confidence: 0.35,
      launchWeight: 0.25,
      realUserData: false,
      captureMode: "local_command",
      verifierPhase: "passed",
      uiSmokePhase: phaseStatus(run, "ui_smoke") ?? "not_included"
    },
    gate: "launch",
    now,
    force: gateNeedsBaselineEvidence(
      gate.blockers,
      "metric snapshot with source, threshold, and current value is missing"
    )
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "migration_plan",
    summary:
      "local_manual startup ready migration plan: no migration is required unless future persistence or schema changes are introduced.",
    sourceRefs: [`startup-ready:${run.id}:migration`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      remediationTask:
        "Recheck migration impact before adding server persistence, schema changes, or shared data stores.",
      acceptanceCriteria:
        "Local launch remains safe when no schema migration is required, or a future migration plan is recorded before release.",
      state: "no_migration_required_for_local_launch",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Recheck migration impact before adding server persistence, schema changes, or shared data stores.",
    acceptanceCriteria:
      "Local launch remains safe when no schema migration is required, or a future migration plan is recorded before release.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "migration plan evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "migration plan", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "rollback_plan",
    summary:
      "local_manual startup ready rollback plan: restore the previous git commit or previous static artifact if local launch regresses.",
    sourceRefs: [`startup-ready:${run.id}:rollback`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      remediationTask:
        "Keep the latest passing git commit and generated static artifact restorable before public traffic.",
      acceptanceCriteria:
        "A failed local launch can be rolled back by reverting the commit or restoring the previous static output.",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Keep the latest passing git commit and generated static artifact restorable before public traffic.",
    acceptanceCriteria:
      "A failed local launch can be rolled back by reverting the commit or restoring the previous static output.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "rollback plan evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "rollback plan", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "observability",
    summary:
      "local_manual startup ready observability baseline: local verifiers, UI smoke, reports, and diagnostics are the launch signals.",
    sourceRefs: [`startup-ready:${run.id}:observability`],
    sources: [localStartupReadySource(run.id, now, "local_command")],
    content: {
      owner: "founder",
      remediationTask:
        "Review verifier output, UI smoke artifacts, launch report, CI summary, and diagnostics after each launch change.",
      acceptanceCriteria:
        "Any failed verifier, smoke check, or launch gate produces an explicit blocker before release.",
      signals: [
        "command verifier evidence",
        "UI smoke DOM evidence",
        "launch readiness report",
        "startup complete product check",
        "ops diagnostics bundle"
      ],
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Review verifier output, UI smoke artifacts, launch report, CI summary, and diagnostics after each launch change.",
    acceptanceCriteria:
      "Any failed verifier, smoke check, or launch gate produces an explicit blocker before release.",
    now,
    force:
      gateNeedsBaselineEvidence(gate.blockers, "observability evidence is missing") ||
      gateNeedsBaselineEvidence(gate.blockers, "observability", "needs owner")
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "release_plan",
    summary:
      "local_manual startup ready release plan: run local verifiers, UI smoke, launch report, and complete-check before pushing.",
    sourceRefs: [`startup-ready:${run.id}:release-plan`],
    sources: [
      {
        kind: "deployment",
        uri: `deployment:local:${run.id}`,
        capturedAt: now.toISOString(),
        freshnessDays: 14,
        trustLevel: "low"
      }
    ],
    content: {
      owner: "founder",
      target: run.target,
      steps: [
        "run repository verifiers",
        "run local UI smoke",
        "generate launch readiness report",
        "run complete product check",
        "push only after local_launch_ready"
      ],
      deployment: "local development server",
      acceptanceCriteria:
        "Runstead reports local_launch_ready or explicit blockers before the repo is pushed.",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Keep the release plan aligned with verifier, UI smoke, and CI commands.",
    acceptanceCriteria:
      "Runstead reports local_launch_ready or explicit blockers before the repo is pushed.",
    now
  });
  await addLocalReadinessEvidenceIfMissing(evidenceTypes, {
    cwd: run.cwd,
    type: "founder_bottleneck",
    summary:
      "local_manual startup ready founder bottleneck baseline: founder owns local launch decision and post-launch triage until handoff evidence exists.",
    sourceRefs: [`startup-ready:${run.id}:founder-bottleneck`],
    sources: [localStartupReadySource(run.id, now, "manual")],
    content: {
      owner: "founder",
      bottlenecks: [
        "local launch decision",
        "release checklist maintenance",
        "post-launch issue triage"
      ],
      systemOfRecord: "Runstead evidence ledger",
      status: "handoff-in-progress",
      confidence: "local_manual"
    },
    gate: "launch",
    owner: "founder",
    remediationTask:
      "Assign durable owners before moving from local launch readiness to scale readiness.",
    acceptanceCriteria:
      "Scale readiness remains blocked until workflow registry, delegation policy, and institutional memory evidence are recorded.",
    now,
    force: gateNeedsBaselineEvidence(
      gate.blockers,
      "founder bottleneck audit is missing"
    )
  });
}

function gateNeedsBaselineEvidence(blockers: string[], ...needles: string[]): boolean {
  const loweredNeedles = needles.map((needle) => needle.toLowerCase());

  return blockers.some((blocker) => {
    const lowered = blocker.toLowerCase();

    return loweredNeedles.every((needle) => lowered.includes(needle));
  });
}

async function addLocalReadinessEvidenceIfMissing(
  evidenceTypes: Set<string>,
  input: {
    cwd: string;
    type: string;
    summary: string;
    sourceRefs: string[];
    sources: Parameters<typeof addStartupEvidence>[0]["sources"];
    content: Record<string, unknown>;
    gate: StartupGateStage;
    owner?: string;
    remediationTask?: string;
    acceptanceCriteria?: string;
    now: Date;
    force?: boolean;
  }
): Promise<void> {
  const storedType = `startup_${input.type}`;

  if (input.force !== true && evidenceTypes.has(storedType)) {
    return;
  }

  await addStartupEvidence({
    cwd: input.cwd,
    type: input.type,
    summary: input.summary,
    sourceRefs: input.sourceRefs,
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    content: JSON.stringify(input.content, null, 2),
    gate: input.gate,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.remediationTask === undefined
      ? {}
      : { remediationTask: input.remediationTask }),
    ...(input.acceptanceCriteria === undefined
      ? {}
      : { acceptanceCriteria: input.acceptanceCriteria }),
    now: input.now
  });
  evidenceTypes.add(storedType);
}

function localStartupReadySource(
  runId: string,
  now: Date,
  kind: "manual" | "local_command"
): {
  kind: string;
  uri: string;
  capturedAt: string;
  freshnessDays: number;
  trustLevel: string;
} {
  return {
    kind,
    uri: `startup-ready:${runId}:${kind}`,
    capturedAt: now.toISOString(),
    freshnessDays: 14,
    trustLevel: "low"
  };
}

function verifierPhaseUpdate(
  run: Awaited<ReturnType<typeof startupBuildMvp>>["verifierRun"]
): Partial<StartupReadinessRunPhase> {
  if (run.status === "skipped") {
    return {
      status: "skipped",
      blockers: [run.reason],
      nextAction: "run startup ready again after the MVP worker completes"
    };
  }

  const failed = run.commandResults.filter(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  return {
    status: run.status === "completed" ? "passed" : "blocked",
    evidenceIds: run.commandResults.map((result) => result.evidenceId),
    blockers: failed.map((result) => `${result.verifier} verifier failed`),
    nextAction:
      failed.length === 0
        ? "continue launch readiness"
        : "repair verifier failures and rerun startup ready"
  };
}

async function startupReadyVerifierPhaseUpdate(
  run: StartupReadinessRun,
  build: StartupReadyMvpBuildExecution,
  options: StartupReadyOptions
): Promise<{
  update: Partial<StartupReadinessRunPhase>;
  verifiedByCurrentEvidence: boolean;
}> {
  if (build.verifierRun.status !== "skipped") {
    return {
      update: verifierPhaseUpdate(build.verifierRun),
      verifiedByCurrentEvidence: false
    };
  }

  const currentEvidence = await collectCurrentStartupReadyVerifierEvidence(run.cwd, {
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (currentEvidence.expectedVerifierNames.length === 0) {
    return {
      update: verifierPhaseUpdate(build.verifierRun),
      verifiedByCurrentEvidence: false
    };
  }

  const blockers = [
    ...currentEvidence.failed.map(
      (evidence) => `${evidence.verifier} verifier evidence failed for current code fingerprint`
    ),
    ...currentEvidence.missingVerifierNames.map(
      (verifier) => `${verifier} verifier evidence is missing for current code fingerprint`
    )
  ];

  if (blockers.length > 0) {
    return {
      update: {
        status: "blocked",
        evidenceIds: currentEvidence.passed.map((evidence) => evidence.evidenceId),
        blockers,
        warnings:
          currentEvidence.passed.length === 0
            ? []
            : [
                "partial current verifier evidence recovered after worker completion failure"
              ],
        nextAction:
          "run missing or failing verifier evidence for the current code fingerprint and resume startup readiness"
      },
      verifiedByCurrentEvidence: false
    };
  }

  return {
    update: {
      status: "passed",
      evidenceIds: currentEvidence.passed.map((evidence) => evidence.evidenceId),
      blockers: [],
      warnings: [
        "verified despite agent completion failure using current code fingerprint verifier evidence"
      ],
      nextAction:
        "current verifier evidence proves the MVP; continue launch readiness"
    },
    verifiedByCurrentEvidence: true
  };
}

interface CurrentStartupReadyVerifierEvidence {
  expectedVerifierNames: string[];
  passed: CurrentStartupReadyVerifierEvidenceMatch[];
  failed: CurrentStartupReadyVerifierEvidenceMatch[];
  missingVerifierNames: string[];
}

interface CurrentStartupReadyVerifierEvidenceMatch {
  verifier: string;
  evidenceId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  forceKilled: boolean;
  createdAt: string;
}

async function collectCurrentStartupReadyVerifierEvidence(
  cwd: string,
  options: { now?: Date } = {}
): Promise<CurrentStartupReadyVerifierEvidence> {
  const expectedVerifierNames = unique(
    (await startupReadyVerifierCommands(cwd, options.now)).map((command) => command.name)
  );

  if (expectedVerifierNames.length === 0) {
    return {
      expectedVerifierNames,
      passed: [],
      failed: [],
      missingVerifierNames: []
    };
  }

  const codeState = await collectCommandVerifierCodeState(cwd);
  const expected = new Set(expectedVerifierNames);
  const latestByVerifier = new Map<string, CurrentStartupReadyVerifierEvidenceMatch>();

  try {
    const state = await requireRunsteadStateDb(cwd);
    const database = openRunsteadDatabase(state.stateDb);

    try {
      const rows = database
        .prepare(
          `
          SELECT id, type, uri, summary, created_at AS createdAt
          FROM evidence
          WHERE type = 'command_output'
          `
        )
        .all() as unknown as StartupReadinessEvidenceRow[];
      const artifacts = await Promise.all(
        rows.map((row) => readStartupReadinessEvidenceArtifact(row.uri))
      );

      rows.forEach((row, index) => {
        const match = currentStartupReadyVerifierEvidenceMatch({
          row,
          artifact: artifacts[index],
          expected,
          codeFingerprint: codeState.fingerprint
        });

        if (match === undefined) {
          return;
        }

        const current = latestByVerifier.get(match.verifier);

        if (
          current === undefined ||
          Date.parse(match.createdAt) > Date.parse(current.createdAt) ||
          (match.createdAt === current.createdAt &&
            match.evidenceId.localeCompare(current.evidenceId) > 0)
        ) {
          latestByVerifier.set(match.verifier, match);
        }
      });
    } finally {
      database.close();
    }
  } catch {
    return {
      expectedVerifierNames,
      passed: [],
      failed: [],
      missingVerifierNames: expectedVerifierNames
    };
  }

  const passed: CurrentStartupReadyVerifierEvidenceMatch[] = [];
  const failed: CurrentStartupReadyVerifierEvidenceMatch[] = [];
  const missingVerifierNames: string[] = [];

  expectedVerifierNames.forEach((verifier) => {
    const match = latestByVerifier.get(verifier);

    if (match === undefined) {
      missingVerifierNames.push(verifier);
      return;
    }

    if (match.exitCode === 0 && match.timedOut === false && match.forceKilled === false) {
      passed.push(match);
      return;
    }

    failed.push(match);
  });

  return {
    expectedVerifierNames,
    passed,
    failed,
    missingVerifierNames
  };
}

function currentStartupReadyVerifierEvidenceMatch(input: {
  row: StartupReadinessEvidenceRow;
  artifact: unknown;
  expected: Set<string>;
  codeFingerprint: string;
}): CurrentStartupReadyVerifierEvidenceMatch | undefined {
  if (!isRecord(input.artifact)) {
    return undefined;
  }

  const verifier = stringValue(input.artifact.verifier);

  if (verifier === undefined || !input.expected.has(verifier)) {
    return undefined;
  }

  const codeState = input.artifact.codeState;

  if (
    !isRecord(codeState) ||
    stringValue(codeState.fingerprint) !== input.codeFingerprint
  ) {
    return undefined;
  }

  const result = input.artifact.result;

  if (!isRecord(result)) {
    return undefined;
  }

  const exitCode =
    typeof result.exitCode === "number"
      ? result.exitCode
      : result.exitCode === null
        ? null
        : undefined;

  if (exitCode === undefined || typeof result.timedOut !== "boolean") {
    return undefined;
  }

  return {
    verifier,
    evidenceId: input.row.id,
    command: stringValue(input.artifact.command) ?? "",
    exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled === true,
    createdAt: input.row.createdAt
  };
}

type StartupBuildMvpResultStatus = Awaited<
  ReturnType<typeof startupBuildMvp>
>["status"];

export function startupBuildMvpPhaseExecutionStatus(
  status: StartupBuildMvpResultStatus,
  execution?: RuntimeExecutionSemantics
): "passed" | "failed" {
  if (
    execution?.verification === "passed" &&
    (execution.implementation === "applied" ||
      execution.implementation === "no_change_needed")
  ) {
    return "passed";
  }

  return status === "completed" || status === "completed_with_warnings"
    ? "passed"
    : "failed";
}

function startupReadyAutoRecoverBuildMvp(input: {
  status: "passed" | "failed";
  execution: RuntimeExecutionSemantics;
  verifierPhase: Partial<StartupReadinessRunPhase>;
}): {
  status: "passed" | "failed";
  execution: RuntimeExecutionSemantics;
  recovered: boolean;
} {
  if (
    input.status === "passed" ||
    input.verifierPhase.status !== "passed" ||
    input.verifierPhase.evidenceIds === undefined ||
    input.verifierPhase.evidenceIds.length === 0
  ) {
    return {
      status: input.status,
      execution: input.execution,
      recovered: false
    };
  }

  return {
    status: "passed",
    execution: {
      implementation:
        input.execution.implementation === "applied" ? "applied" : "no_change_needed",
      verification: "passed",
      agentCompletion: input.execution.agentCompletion
    },
    recovered: true
  };
}

function startupBuildMvpPhaseExecutionWarnings(
  execution: RuntimeExecutionSemantics,
  options: {
    verifiedByCurrentEvidence?: boolean;
    verifierOnlyRecovery?: boolean;
  } = {}
): string[] {
  return unique([
    ...(execution.verification === "passed" && execution.agentCompletion !== "completed"
      ? [
          `MVP verification passed after agent completion reported ${execution.agentCompletion}`
        ]
      : []),
    ...(options.verifiedByCurrentEvidence === true &&
    execution.agentCompletion !== "completed"
      ? [
          `MVP verified despite agent completion failure using current code fingerprint evidence`
        ]
      : []),
    ...(options.verifierOnlyRecovery === true
      ? [
          "Runstead recovered without re-running the agent using current verifier evidence"
        ]
      : [])
  ]);
}

function phaseStatus(
  run: StartupReadinessRun,
  id: string
): StartupReadinessPhaseStatus | undefined {
  return run.phases.find((phase) => phase.id === id)?.status;
}

async function finalizeRun(
  run: StartupReadinessRun,
  now: Date,
  options: { extraEvidenceTiers?: StartupReadinessEvidenceTier[] } = {}
): Promise<StartupReadinessRun> {
  const codeState = await collectStartupReadyCodeState(run.cwd);
  const recordedEvidence = await collectRecordedStartupReadinessEvidence(run.cwd, {
    now,
    codeFingerprint: codeState.fingerprint
  });
  const evidenceTiers = uniqueEvidenceTiers([
    ...inferPhaseEvidenceTiers(run),
    ...recordedEvidence.evidenceTiers,
    ...(options.extraEvidenceTiers ?? [])
  ]);
  const extensions = await loadStartupReadinessExtensions({ cwd: run.cwd });
  const extensionRequirements = startupReadinessExtensionEvidenceRequirements(
    extensions.extensions,
    { stage: run.stage }
  );
  const extensionPolicyBlockers = startupReadinessExtensionPolicyBlockers({
    extensions: extensions.extensions,
    requirements: extensionRequirements,
    target: run.target,
    worker: run.worker,
    governanceProfile: run.governanceProfile
  });
  const extensionLoaderBlockers = [...extensions.issues, ...extensionPolicyBlockers];
  const runForVerdict =
    extensionLoaderBlockers.length === 0
      ? run
      : {
          ...run,
          phases: [
            ...run.phases,
            {
              id: "extensions",
              title: "Extension loader",
              status: "blocked" as const,
              evidenceIds: [],
              artifacts: extensions.discoveredPaths,
              blockers: extensionLoaderBlockers
            }
          ]
        };
  const verdict = evaluateStartupReadinessVerdict({
    run: runForVerdict,
    evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes,
    evidenceRequirements: extensionRequirements,
    staleEvidenceRefs: recordedEvidence.staleEvidenceRefs,
    supersededEvidenceRefs: recordedEvidence.supersededEvidenceRefs
  });
  const phaseStatuses = run.phases.map((phase) => phase.status);
  const status = phaseStatuses.includes("failed")
    ? "failed"
    : phaseStatuses.includes("blocked") || verdict.blockers.length > 0
      ? "blocked"
      : "completed";

  return {
    ...run,
    status,
    evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes,
    evidenceRequirements: extensionRequirements,
    staleEvidenceRefs: recordedEvidence.staleEvidenceRefs,
    supersededEvidenceRefs: recordedEvidence.supersededEvidenceRefs,
    ...(codeState.gitHead === undefined ? {} : { gitHead: codeState.gitHead }),
    dirtyState: codeState.dirtyState,
    codeFingerprint: codeState.fingerprint,
    verdict: verdict.verdict,
    verdictBlockers: verdict.blockers,
    completedAt: now.toISOString()
  };
}

async function writeStartupReadinessDecisionReport(
  run: StartupReadinessRun,
  now: Date
): Promise<StartupReadinessRun> {
  const root = await resolveRunsteadRoot(run.cwd);
  const reportDir = join(root.root, "reports");
  const markdownPath = join(reportDir, `startup-readiness-run-${run.id}.md`);
  const jsonPath = join(reportDir, `startup-readiness-run-${run.id}.json`);
  const decisions = startupReadinessDecisionMatrix(run);
  const verdict = evaluateStartupReadinessVerdict({
    run,
    evidenceTiers: run.evidenceTiers,
    evidenceTypes: run.evidenceTypes,
    evidenceRequirements: run.evidenceRequirements,
    staleEvidenceRefs: run.staleEvidenceRefs,
    supersededEvidenceRefs: run.supersededEvidenceRefs
  });
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    run: {
      id: run.id,
      cwd: run.cwd,
      stage: run.stage,
      target: run.target,
      worker: run.worker,
      workerGovernance: formatStartupWorkerGovernanceNotice(run.worker),
      ...(run.scaffoldProfile === undefined
        ? {}
        : { scaffoldProfile: run.scaffoldProfile }),
      status: run.status,
      verdict: run.verdict,
      verdictBlockers: run.verdictBlockers,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      gitHead: run.gitHead,
      dirtyState: run.dirtyState,
      codeFingerprint: run.codeFingerprint
    },
    verdict: {
      requested: {
        target: verdict.target,
        verdict: verdict.verdict,
        canLaunch: verdict.canLaunch,
        blockers: verdict.blockers,
        warnings: verdict.warnings,
        evidenceRefs: verdict.evidenceRefs,
        staleEvidenceRefs: verdict.staleEvidenceRefs,
        supersededEvidenceRefs: verdict.supersededEvidenceRefs
      },
      targetReadiness: verdict.targetReadiness
    },
    targetBoundary: startupReadinessTargetBoundary(run.target),
    guidedFlow: buildStartupReadyGuidedFlow(run),
    operatorCommands: buildStartupReadyOperatorCommands(run),
    decisions,
    evidence: {
      ids: run.evidenceIds,
      tiers: run.evidenceTiers,
      types: run.evidenceTypes,
      phaseEvidence: run.phases.map((phase) => ({
        phase: phase.id,
        status: phase.status,
        ...(phase.execution === undefined ? {} : { execution: phase.execution }),
        evidenceIds: phase.evidenceIds,
        artifacts: phase.artifacts,
        blockers: phase.blockers,
        ...(phase.warnings === undefined ? {} : { warnings: phase.warnings })
      }))
    },
    reports: unique([...run.reportPaths, markdownPath, jsonPath])
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    formatStartupReadinessDecisionMarkdown(payload),
    "utf8"
  );

  run.reportPaths = unique([...run.reportPaths, markdownPath, jsonPath]);
  if (hasPhase(run, "launch_report")) {
    const launchReport = run.phases.find((phase) => phase.id === "launch_report");

    updatePhase(run, "launch_report", {
      artifacts: unique([...(launchReport?.artifacts ?? []), markdownPath, jsonPath])
    });
  }
  collectRunEvidence(run);

  return run;
}

async function writeStartupReadinessCiOutputs(
  run: StartupReadinessRun,
  now: Date
): Promise<StartupReadinessRun> {
  const ci = await generateStartupCiSummary({
    cwd: run.cwd,
    stage: startupReadyStageToGateStage(run.stage),
    checkName: "Runstead Startup Readiness",
    readiness: {
      verdict: run.verdict,
      blockers: run.verdictBlockers
    },
    now
  });

  run.reportPaths = unique([...run.reportPaths, ci.markdownPath, ci.jsonPath]);
  if (!run.evidenceTiers.includes("ci_verified")) {
    run.evidenceTiers = [...run.evidenceTiers, "ci_verified"];
  }

  const reportPhaseId = hasPhase(run, "launch_report")
    ? "launch_report"
    : hasPhase(run, "complete_check")
      ? "complete_check"
      : undefined;

  if (reportPhaseId !== undefined) {
    const reportPhase = run.phases.find((phase) => phase.id === reportPhaseId);

    updatePhase(run, reportPhaseId, {
      artifacts: unique([
        ...(reportPhase?.artifacts ?? []),
        ci.markdownPath,
        ci.jsonPath
      ])
    });
  }

  collectRunEvidence(run);

  return run;
}

function startupReadyStageToGateStage(
  stage: StartupReadyStage
): "mvp" | "launch" | "scale" {
  if (stage === "mvp") {
    return "mvp";
  }

  if (stage === "scale") {
    return "scale";
  }

  return "launch";
}

function isStartupReadyVerdict(verdict: StartupReadinessVerdict): boolean {
  return verdict.endsWith("_ready");
}

function startupReadinessDecisionMatrix(run: StartupReadinessRun): {
  localDemo: StartupReadinessDecision;
  privateBeta: StartupReadinessDecision;
  publicLaunch: StartupReadinessDecision;
} {
  return {
    localDemo: startupReadinessDecision({
      surface: "local_demo",
      title: "Local demo",
      target: "local",
      run
    }),
    privateBeta: startupReadinessDecision({
      surface: "private_beta",
      title: "Private beta / staging",
      target: "staging",
      run
    }),
    publicLaunch: startupReadinessDecision({
      surface: "public_launch",
      title: "Public launch",
      target: "production",
      run
    })
  };
}

interface StartupReadinessDecision {
  surface: "local_demo" | "private_beta" | "public_launch";
  title: string;
  target: StartupReadyTarget;
  canLaunch: boolean;
  verdict: StartupReadinessVerdict;
  blockers: string[];
  nextAction: string;
}

function startupReadinessDecision(input: {
  surface: StartupReadinessDecision["surface"];
  title: string;
  target: StartupReadyTarget;
  run: StartupReadinessRun;
}): StartupReadinessDecision {
  const evaluated = evaluateStartupReadinessVerdict({
    run: {
      target: input.target,
      phases: input.run.phases
    },
    evidenceTiers: input.run.evidenceTiers,
    evidenceTypes: input.run.evidenceTypes,
    evidenceRequirements: input.run.evidenceRequirements,
    staleEvidenceRefs: input.run.staleEvidenceRefs,
    supersededEvidenceRefs: input.run.supersededEvidenceRefs
  });

  return {
    surface: input.surface,
    title: input.title,
    target: input.target,
    canLaunch: evaluated.blockers.length === 0,
    verdict: evaluated.verdict,
    blockers: evaluated.blockers,
    nextAction:
      evaluated.blockers.length === 0
        ? `launch target ${input.target} with recorded evidence`
        : nextStartupReadinessAction(evaluated.blockers)
  };
}

interface StartupReadinessTargetBoundary {
  requestedTarget: StartupReadyTarget;
  boundary: string;
  allowedUse: string;
  notEvidenceFor: string[];
  requiredNextEvidence: string[];
}

function startupReadinessTargetBoundary(
  target: StartupReadyTarget
): StartupReadinessTargetBoundary {
  if (target === "local") {
    return {
      requestedTarget: target,
      boundary:
        "local_launch_ready covers local demo and local operator validation only; it is not public launch clearance.",
      allowedUse:
        "Use this verdict for founder demos, local QA, and deciding whether the MVP is ready for a private staging run.",
      notEvidenceFor: [
        "public traffic",
        "production deployment safety",
        "CI-backed regression protection",
        "real-user analytics",
        "support or incident readiness"
      ],
      requiredNextEvidence: [
        "CI summary artifact",
        "staging deployment evidence",
        "rollback drill, migration validation, and monitoring alert evidence from the deployment target",
        "real-user analytics or support triage evidence before production"
      ]
    };
  }

  if (target === "staging") {
    return {
      requestedTarget: target,
      boundary:
        "staging_launch_ready covers private beta or staging rollout only; it is not production launch clearance.",
      allowedUse:
        "Use this verdict for controlled beta testers, staging release candidates, and pre-production signoff.",
      notEvidenceFor: [
        "unrestricted public launch",
        "production incident response readiness",
        "production real-user analytics"
      ],
      requiredNextEvidence: [
        "production deployment evidence",
        "production rollback drill",
        "production monitoring alerts, error budget, and migration validation",
        "real-user traffic gate, analytics, support triage, and post-launch watch evidence"
      ]
    };
  }

  return {
    requestedTarget: target,
    boundary:
      "public_launch_ready is the only Runstead readiness verdict that claims production/public launch clearance.",
    allowedUse:
      "Use this verdict only when CI, deployment, rollback drill, monitoring alerts, error budget, migration validation, traffic gate, real-user, support, and post-launch watch evidence are all current.",
    notEvidenceFor: [
      "ongoing scale safety after launch",
      "compliance certification beyond the recorded evidence",
      "future product changes without fresh verification"
    ],
    requiredNextEvidence: [
      "post-launch monitoring review",
      "traffic gate and error budget review",
      "support ticket and feedback triage",
      "scale readiness evidence before delegation or growth spend"
    ]
  };
}

function formatStartupReadinessTargetBoundaryLines(
  boundary: StartupReadinessTargetBoundary
): string[] {
  return [
    `- Requested target: ${boundary.requestedTarget}`,
    `- Boundary: ${boundary.boundary}`,
    `- Allowed use: ${boundary.allowedUse}`,
    `- Not evidence for: ${boundary.notEvidenceFor.join("; ")}`,
    `- Required next evidence: ${boundary.requiredNextEvidence.join("; ")}`
  ];
}

function formatStartupReadinessDecisionMarkdown(input: {
  generatedAt: string;
  run: {
    id: string;
    cwd: string;
    stage: StartupReadyStage;
    target: StartupReadyTarget;
    worker: LocalAgentWorkerKind;
    workerGovernance: string;
    scaffoldProfile?: StartupScaffoldProfile;
    status: StartupReadinessRunStatus;
    verdict: StartupReadinessVerdict;
    verdictBlockers: string[];
    startedAt: string;
    completedAt: string | undefined;
    gitHead: string | undefined;
    dirtyState: StartupReadinessDirtyState;
    codeFingerprint: string | undefined;
  };
  decisions: {
    localDemo: StartupReadinessDecision;
    privateBeta: StartupReadinessDecision;
    publicLaunch: StartupReadinessDecision;
  };
  targetBoundary: StartupReadinessTargetBoundary;
  guidedFlow: StartupReadyGuidedStep[];
  operatorCommands: StartupReadyOperatorCommand[];
  evidence: {
    ids: string[];
    tiers: StartupReadinessEvidenceTier[];
    types: string[];
    phaseEvidence: {
      phase: string;
      status: StartupReadinessPhaseStatus;
      execution?: RuntimeExecutionSemantics;
      evidenceIds: string[];
      artifacts: string[];
      blockers: string[];
      warnings?: string[];
    }[];
  };
  reports: string[];
}): string {
  const decisions = [
    input.decisions.localDemo,
    input.decisions.privateBeta,
    input.decisions.publicLaunch
  ];
  const blockers = decisions.flatMap((decision) =>
    decision.blockers.map((blocker) => `${decision.title}: ${blocker}`)
  );

  return [
    "# Startup Readiness Decision",
    "",
    `Generated: ${input.generatedAt}`,
    `Run: ${input.run.id}`,
    `Workspace: ${input.run.cwd}`,
    `Stage: ${input.run.stage}`,
    `Requested target: ${input.run.target}`,
    `Worker: ${input.run.worker}`,
    input.run.workerGovernance,
    ...(input.run.scaffoldProfile === undefined
      ? []
      : [
          `Scaffold profile: ${input.run.scaffoldProfile.id} (${input.run.scaffoldProfile.title})`
        ]),
    `Status: ${input.run.status}`,
    `Verdict: ${input.run.verdict}`,
    "",
    "## Can this launch?",
    "",
    "| Surface | Answer | Verdict | Next action |",
    "| --- | --- | --- | --- |",
    ...decisions.map(
      (decision) =>
        `| ${decision.title} | ${decision.canLaunch ? "yes" : "no"} | ${decision.verdict} | ${decision.nextAction} |`
    ),
    "",
    "## Target Boundary",
    "",
    ...formatStartupReadinessTargetBoundaryLines(input.targetBoundary),
    "",
    "## Guided Flow",
    "",
    "| Step | Status | Owner | Why | Next action |",
    "| --- | --- | --- | --- | --- |",
    ...input.guidedFlow.map(
      (step) =>
        `| ${step.title} | ${step.status} | ${step.resolution} | ${step.why} | ${step.nextAction} |`
    ),
    "",
    "## Operator Commands",
    "",
    "| Command | When |",
    "| --- | --- |",
    ...input.operatorCommands.map((item) => `| \`${item.command}\` | ${item.when} |`),
    "",
    "## Why not?",
    "",
    blockers.length === 0
      ? "- No blockers for local demo, private beta, or public launch."
      : blockers.map((blocker) => `- ${blocker}`).join("\n"),
    "",
    "## Evidence",
    "",
    `- Git SHA: ${input.run.gitHead ?? "unknown"}`,
    `- Dirty state: ${input.run.dirtyState}`,
    `- Code fingerprint: ${input.run.codeFingerprint ?? "unknown"}`,
    `- Started: ${input.run.startedAt}`,
    `- Completed: ${input.run.completedAt ?? "not completed"}`,
    `- Evidence tiers: ${input.evidence.tiers.length === 0 ? "none" : input.evidence.tiers.join(", ")}`,
    `- Evidence types: ${input.evidence.types.length === 0 ? "none" : input.evidence.types.join(", ")}`,
    `- Evidence ids: ${input.evidence.ids.length === 0 ? "none" : input.evidence.ids.join(", ")}`,
    "",
    "## Phase Evidence",
    "",
    "| Phase | Status | Execution | Evidence | Artifacts | Blockers | Warnings |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...input.evidence.phaseEvidence.map(
      (phase) =>
        `| ${phase.phase} | ${phase.status} | ${formatStartupPhaseExecution(phase.execution)} | ${phase.evidenceIds.length === 0 ? "none" : phase.evidenceIds.join(", ")} | ${phase.artifacts.length === 0 ? "none" : phase.artifacts.join("<br>")} | ${phase.blockers.length === 0 ? "none" : phase.blockers.join("<br>")} | ${phase.warnings === undefined || phase.warnings.length === 0 ? "none" : phase.warnings.join("<br>")} |`
    ),
    "",
    "## Reports",
    "",
    input.reports.length === 0
      ? "- none"
      : input.reports.map((path) => `- ${path}`).join("\n"),
    ""
  ].join("\n");
}

function formatStartupPhaseExecution(
  execution: RuntimeExecutionSemantics | undefined
): string {
  return execution === undefined
    ? "none"
    : `implementation=${execution.implementation}<br>verification=${execution.verification}<br>agentCompletion=${execution.agentCompletion}`;
}

export function buildStartupReadyGuidedFlow(
  run: StartupReadinessRun
): StartupReadyGuidedStep[] {
  const blockedPhases = run.phases.filter(
    (phase) => phase.status === "blocked" || phase.status === "failed"
  );
  const phaseSteps = blockedPhases.map((phase, index) =>
    startupReadyGuidedStepForPhase(run, phase, index)
  );

  if (phaseSteps.length > 0) {
    return phaseSteps;
  }

  const requestedDecision = startupReadinessDecision({
    surface:
      run.target === "local"
        ? "local_demo"
        : run.target === "staging"
          ? "private_beta"
          : "public_launch",
    title:
      run.target === "local"
        ? "Local demo"
        : run.target === "staging"
          ? "Private beta / staging"
          : "Public launch",
    target: run.target,
    run
  });

  if (requestedDecision.blockers.length > 0) {
    return requestedDecision.blockers.map((blocker, index) =>
      startupReadyGuidedStepForBlocker({
        id: `target_${index + 1}`,
        title: `Target evidence: ${run.target}`,
        blocker,
        fallbackNextAction: requestedDecision.nextAction,
        run
      })
    );
  }

  const boundary = startupReadinessTargetBoundary(run.target);

  return [
    {
      id: "next_target",
      title: `Next target after ${run.target}`,
      status: "next",
      resolution: "manual",
      why: boundary.boundary,
      nextAction: boundary.requiredNextEvidence.join("; "),
      blockers: []
    }
  ];
}

export function buildStartupReadyOperatorCommands(
  run: StartupReadinessRun
): StartupReadyOperatorCommand[] {
  const cwd = startupReadyShellArg(run.cwd);
  const governanceProfile = startupReadinessRunGovernanceProfile(run);
  const readyCommand = [
    "runstead startup ready",
    `--cwd ${cwd}`,
    `--stage ${run.stage}`,
    `--target ${run.target}`,
    `--worker ${run.worker}`,
    `--governance ${governanceProfile}`,
    ...(run.scaffoldProfile?.template === undefined
      ? []
      : [`--app-template ${run.scaffoldProfile.template}`]),
    ...(run.scaffoldProfile?.appType === undefined
      ? []
      : [`--app-type ${run.scaffoldProfile.appType}`])
  ].join(" ");
  const commands: StartupReadyOperatorCommand[] = [
    {
      kind: "resume",
      title: "Resume this readiness run",
      command: `runstead startup ready --cwd ${cwd} --resume ${run.id}`,
      when: "Continue the same run after an interruption, approval, or manual evidence update."
    },
    {
      kind: "rerun",
      title: "Run the same readiness gate again",
      command: readyCommand,
      when: "Re-evaluate after code, evidence, or configuration changes."
    },
    {
      kind: "dashboard",
      title: "Rebuild the local dashboard",
      command: `runstead dashboard build --cwd ${cwd}`,
      when: "Refresh the local HTML/JSON control-plane view for this workspace."
    },
    {
      kind: "complete_check",
      title: "Run complete-product audit",
      command: `runstead startup complete-check --cwd ${cwd} --target ${run.target}`,
      when: "Verify launch report, CI gate, dashboard, diagnostics, remediation, evidence, and events."
    }
  ];

  if (startupReadyVerifierOnlyRecoveryAvailable(run)) {
    commands.unshift({
      kind: "recover",
      title: "Recover with verifier-only evaluation",
      command: `runstead startup ready --cwd ${cwd} --resume ${run.id}`,
      when:
        "Runstead can recover without re-running the agent because current verifier evidence exists."
    });
  }

  if (
    run.target !== "local" ||
    run.verdictBlockers.some((blocker) => blocker.toLowerCase().includes("ci"))
  ) {
    commands.splice(2, 0, {
      kind: "ci",
      title: "Attach CI summary evidence",
      command: `${readyCommand} --ci`,
      when: "Record CI summary artifacts for staging or production readiness evidence."
    });
  }

  return commands;
}

function startupReadyVerifierOnlyRecoveryAvailable(run: StartupReadinessRun): boolean {
  const build = run.phases.find((phase) => phase.id === "build_mvp");
  const verifiers = run.phases.find((phase) => phase.id === "verifiers");

  if (build === undefined || verifiers?.status !== "passed") {
    return false;
  }

  return (
    build.status === "failed" ||
    build.status === "blocked" ||
    build.warnings?.some((warning) =>
      warning.toLowerCase().includes("recovered without re-running the agent")
    ) === true ||
    build.nextAction?.toLowerCase().includes("without re-running the agent") === true
  );
}

function startupReadyGuidedStepForPhase(
  run: StartupReadinessRun,
  phase: StartupReadinessRunPhase,
  index: number
): StartupReadyGuidedStep {
  const blocker = phase.blockers[0] ?? `${phase.title} has not completed successfully`;

  return startupReadyGuidedStepForBlocker({
    id: `${phase.id}_${index + 1}`,
    title: phase.title,
    blocker,
    fallbackNextAction: phase.nextAction ?? nextStartupReadinessAction([blocker]),
    run,
    blockers: phase.blockers.length === 0 ? [blocker] : phase.blockers
  });
}

function startupReadyGuidedStepForBlocker(input: {
  id: string;
  title: string;
  blocker: string;
  fallbackNextAction: string;
  run: StartupReadinessRun;
  blockers?: string[];
}): StartupReadyGuidedStep {
  const resolution = startupReadyGuidedResolution(input.blocker);
  const command = startupReadyGuidedCommand({
    blocker: input.blocker,
    resolution,
    run: input.run
  });

  return {
    id: input.id,
    title: input.title,
    status: "blocked",
    resolution,
    why: startupReadyGuidedWhy(input.blocker),
    nextAction: startupReadyGuidedNextAction({
      blocker: input.blocker,
      fallbackNextAction: input.fallbackNextAction,
      resolution,
      run: input.run
    }),
    ...(command === undefined ? {} : { command }),
    blockers: input.blockers ?? [input.blocker]
  };
}

function startupReadyGuidedResolution(blocker: string): StartupReadyGuidedResolution {
  const lower = blocker.toLowerCase();

  if (
    lower.includes("deployment") ||
    lower.includes("analytics") ||
    lower.includes("support") ||
    lower.includes("feedback") ||
    lower.includes("rollback") ||
    lower.includes("observability") ||
    lower.includes("migration") ||
    lower.includes("release-plan")
  ) {
    return "manual";
  }

  if (
    lower.includes("ui smoke") ||
    lower.includes("verifier") ||
    lower.includes("repo readiness") ||
    lower.includes("security baseline") ||
    lower.includes("ci provider") ||
    lower.includes("ci-verified")
  ) {
    return "agent";
  }

  return "runstead";
}

function startupReadyGuidedWhy(blocker: string): string {
  const lower = blocker.toLowerCase();

  if (lower.includes("ui smoke")) {
    return "Runstead cannot prove the primary product flow works in a browser.";
  }

  if (lower.includes("verifier") || lower.includes("local command")) {
    return "The launch gate needs current command evidence from tests, lint, typecheck, or build.";
  }

  if (lower.includes("ci")) {
    return "The requested target needs remote regression evidence, not only local execution.";
  }

  if (lower.includes("deployment")) {
    return "The requested target needs evidence from the actual deployment surface.";
  }

  if (lower.includes("rollback")) {
    return "Launch readiness needs proof that the release can be reversed safely.";
  }

  if (lower.includes("observability")) {
    return "Launch readiness needs a monitoring and alerting baseline for the release target.";
  }

  if (lower.includes("analytics")) {
    return "Production readiness needs measured real-user behavior, not synthetic smoke alone.";
  }

  if (lower.includes("support") || lower.includes("feedback")) {
    return "Production readiness needs a triage path for user feedback or incidents.";
  }

  return `Runstead is missing evidence for: ${blocker}.`;
}

function startupReadyGuidedNextAction(input: {
  blocker: string;
  fallbackNextAction: string;
  resolution: StartupReadyGuidedResolution;
  run: StartupReadinessRun;
}): string {
  if (input.resolution === "agent") {
    return `let ${input.run.worker} repair the repo, then resume this readiness run`;
  }

  if (input.resolution === "manual") {
    return input.fallbackNextAction;
  }

  return input.fallbackNextAction;
}

function startupReadyGuidedCommand(input: {
  blocker: string;
  resolution: StartupReadyGuidedResolution;
  run: StartupReadinessRun;
}): string | undefined {
  if (input.resolution === "agent") {
    return `runstead startup ready --cwd ${input.run.cwd} --resume ${input.run.id}`;
  }

  if (input.blocker.toLowerCase().includes("ci")) {
    return `runstead startup ready --cwd ${input.run.cwd} --stage ${input.run.stage} --target ${input.run.target} --ci`;
  }

  return undefined;
}

function formatStartupReadyGuidedFlowLines(steps: StartupReadyGuidedStep[]): string[] {
  return steps.map((step) => {
    const command = step.command === undefined ? "" : ` command: ${step.command};`;

    return `- [${step.status}] ${step.title}: ${step.resolution};${command} why: ${step.why}; next: ${step.nextAction}`;
  });
}

function formatStartupReadyOperatorCommandLines(
  commands: StartupReadyOperatorCommand[]
): string[] {
  return commands.map((item) => `- ${item.title}: ${item.command} (${item.when})`);
}

function nextStartupReadinessAction(blockers: string[]): string {
  const blocker = blockers[0];

  if (blocker === undefined) {
    return "continue launch readiness";
  }

  if (blocker.includes("CI")) {
    return "run startup ready in CI and attach CI summary evidence";
  }

  if (blocker.includes("deployment")) {
    return "attach deployment evidence for the requested target";
  }

  if (blocker.includes("analytics")) {
    return "record a real-user analytics metric snapshot";
  }

  if (blocker.includes("rollback")) {
    return "record rollback-plan evidence";
  }

  if (blocker.includes("observability")) {
    return "record observability evidence";
  }

  return blocker;
}

export function evaluateStartupReadinessVerdict(input: {
  run: Pick<StartupReadinessRun, "target" | "phases">;
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes?: string[];
  evidenceRequirements?: ReadinessEvidenceRequirement[];
  staleEvidenceRefs?: string[];
  supersededEvidenceRefs?: string[];
}): StartupVerdictResult {
  return evaluateStartupVerdict({
    target: input.run.target,
    phases: input.run.phases,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes ?? [],
    evidenceRequirements: input.evidenceRequirements ?? [],
    staleEvidenceRefs: input.staleEvidenceRefs ?? [],
    supersededEvidenceRefs: input.supersededEvidenceRefs ?? []
  });
}

async function collectRecordedStartupReadinessEvidence(
  cwd: string,
  options: { now?: Date; codeFingerprint?: string } = {}
): Promise<{
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}> {
  try {
    const state = await requireRunsteadStateDb(cwd);
    const database = openRunsteadDatabase(state.stateDb);
    const checkedAt = (options.now ?? new Date()).toISOString();

    try {
      const rows = database
        .prepare(
          `
          SELECT id, type, uri, summary, created_at AS createdAt
          FROM evidence
          WHERE type = 'command_output' OR type LIKE 'startup_%'
          `
        )
        .all() as unknown as StartupReadinessEvidenceRow[];
      const artifacts = await Promise.all(
        rows.map((row) => readStartupReadinessEvidenceArtifact(row.uri))
      );
      const staleEvidenceRefs = unique(
        rows.flatMap((row, index) =>
          startupReadinessEvidenceIsStale(
            artifacts[index],
            checkedAt,
            options.codeFingerprint
          )
            ? [row.id]
            : []
        )
      );
      const supersededEvidenceRefs = unique(
        supersededStartupReadinessEvidenceRefs(rows, artifacts)
      );
      const excludedRefs = new Set([...staleEvidenceRefs, ...supersededEvidenceRefs]);
      const activeEvidence = rows
        .map((row, index) => ({ row, artifact: artifacts[index] }))
        .filter(({ row }) => !excludedRefs.has(row.id));

      return {
        evidenceTiers: uniqueEvidenceTiers(
          activeEvidence.flatMap(({ row, artifact }) =>
            inferRecordedEvidenceTiers(row, artifact)
          )
        ),
        evidenceTypes: unique(activeEvidence.map(({ row }) => row.type)),
        staleEvidenceRefs,
        supersededEvidenceRefs
      };
    } finally {
      database.close();
    }
  } catch {
    return {
      evidenceTiers: [],
      evidenceTypes: [],
      staleEvidenceRefs: [],
      supersededEvidenceRefs: []
    };
  }
}

interface StartupReadinessEvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary?: string | null;
  createdAt: string;
}

function inferRecordedEvidenceTiers(
  row: StartupReadinessEvidenceRow,
  artifact: unknown
): StartupReadinessEvidenceTier[] {
  const text = evidenceSearchText(row, artifact);
  const tiers: StartupReadinessEvidenceTier[] = [];

  if (row.type === "command_output") {
    tiers.push("local_command");
  }

  if (row.type === "startup_ui_validation" || text.includes("synthetic")) {
    tiers.push("synthetic_smoke");
  }

  if (text.includes("founder_manual") || text.includes("local_manual")) {
    tiers.push("local_manual");
  }

  if (
    row.type === "startup_ci_summary" ||
    text.includes("github actions") ||
    text.includes("ci_verified") ||
    text.includes("ci verified")
  ) {
    tiers.push("ci_verified");
  }

  if (text.includes("staging_deployment") || stagingDeploymentText(text)) {
    tiers.push("staging_deployment");
  }

  if (
    text.includes("production_deployment") ||
    text.includes("production deployment") ||
    text.includes("prod deployment")
  ) {
    tiers.push("production_deployment");
  }

  if (
    row.type === "startup_metric_snapshot" &&
    (text.includes("analytics_real_user") ||
      text.includes("real_user_analytics") ||
      /realuserdata\\?":\s*true/.test(text))
  ) {
    tiers.push("real_user_analytics");
  }

  if (row.type === "startup_support_triage" || text.includes("support_ticket")) {
    tiers.push("support_ticket");
  }

  if (row.type === "startup_security_baseline" || text.includes("security_scan")) {
    tiers.push("security_scan");
  }

  return uniqueEvidenceTiers(tiers);
}

async function readStartupReadinessEvidenceArtifact(uri: string): Promise<unknown> {
  try {
    const path = uri.startsWith("file:") ? fileURLToPath(uri) : uri;

    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function evidenceSearchText(
  row: StartupReadinessEvidenceRow,
  artifact: unknown
): string {
  return `${row.type} ${row.uri} ${row.summary ?? ""} ${JSON.stringify(artifact ?? {})}`.toLowerCase();
}

function startupReadinessEvidenceIsStale(
  artifact: unknown,
  checkedAt: string,
  currentCodeFingerprint?: string
): boolean {
  return (
    startupReadinessEvidenceCodeFingerprintStale(artifact, currentCodeFingerprint) ||
    startupReadinessArtifactSources(artifact).some((source) => {
      if (
        typeof source.uri !== "string" ||
        typeof source.capturedAt !== "string" ||
        typeof source.freshnessDays !== "number"
      ) {
        return false;
      }

      const capturedAt = Date.parse(source.capturedAt);
      const checkedAtMs = Date.parse(checkedAt);

      if (Number.isNaN(capturedAt) || Number.isNaN(checkedAtMs)) {
        return false;
      }

      const ageDays = Math.floor((checkedAtMs - capturedAt) / 86_400_000);

      return ageDays > source.freshnessDays;
    })
  );
}

function startupReadinessEvidenceCodeFingerprintStale(
  artifact: unknown,
  currentCodeFingerprint: string | undefined
): boolean {
  if (currentCodeFingerprint === undefined || !isRecord(artifact)) {
    return false;
  }

  const codeState = artifact.codeState;

  if (!isRecord(codeState) || typeof codeState.fingerprint !== "string") {
    return false;
  }

  return codeState.fingerprint !== currentCodeFingerprint;
}

function supersededStartupReadinessEvidenceRefs(
  rows: StartupReadinessEvidenceRow[],
  artifacts: unknown[]
): string[] {
  const latest = new Map<string, StartupReadinessEvidenceRow>();

  rows.forEach((row, index) => {
    if (!row.type.startsWith("startup_")) {
      return;
    }

    const key = startupReadinessEvidenceCurrentKey(row, artifacts[index]);
    const current = latest.get(key);

    if (
      current === undefined ||
      Date.parse(row.createdAt) > Date.parse(current.createdAt) ||
      (row.createdAt === current.createdAt && row.id.localeCompare(current.id) > 0)
    ) {
      latest.set(key, row);
    }
  });

  return rows.flatMap((row, index) => {
    if (!row.type.startsWith("startup_")) {
      return [];
    }

    const key = startupReadinessEvidenceCurrentKey(row, artifacts[index]);

    return latest.get(key)?.id === row.id ? [] : [row.id];
  });
}

function startupReadinessEvidenceCurrentKey(
  row: StartupReadinessEvidenceRow,
  artifact: unknown
): string {
  const content = parsedStartupReadinessArtifactContent(artifact);

  if (row.type === "startup_ui_validation") {
    const url = isRecord(content) ? stringValue(content.url) : undefined;
    const viewport = isRecord(content) ? stringValue(content.viewport) : undefined;

    return `${row.type}:${url ?? row.uri}:${viewport ?? "unknown"}`;
  }

  if (row.type === "startup_metric" || row.type === "startup_metric_snapshot") {
    const metric = isRecord(content) ? stringValue(content.metric) : undefined;

    return `${row.type}:${metric ?? row.uri}`;
  }

  return row.type;
}

function parsedStartupReadinessArtifactContent(artifact: unknown): unknown {
  if (!isRecord(artifact)) {
    return undefined;
  }

  if (typeof artifact.content !== "string") {
    return artifact;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return artifact.content;
  }
}

function startupReadinessArtifactSources(artifact: unknown): Record<string, unknown>[] {
  if (!isRecord(artifact) || !Array.isArray(artifact.sources)) {
    return [];
  }

  return artifact.sources.filter(isRecord);
}

function stagingDeploymentText(text: string): boolean {
  return text.includes("staging") && text.includes("deployment");
}

function updatePhase(
  run: StartupReadinessRun,
  id: string,
  update: Partial<StartupReadinessRunPhase>
): void {
  const phase = run.phases.find((candidate) => candidate.id === id);

  if (phase === undefined) {
    return;
  }

  Object.assign(phase, {
    ...update,
    evidenceIds: update.evidenceIds ?? phase.evidenceIds,
    artifacts: update.artifacts ?? phase.artifacts,
    blockers: update.blockers ?? phase.blockers,
    warnings: update.warnings ?? phase.warnings
  });
}

function resetResumablePhase(
  phase: StartupReadinessRunPhase
): StartupReadinessRunPhase {
  if (phase.status === "passed" || phase.status === "skipped") {
    return phase;
  }

  const rest = { ...phase };
  delete rest.nextAction;

  return {
    ...rest,
    status: "pending",
    blockers: []
  };
}

function hasPhase(run: StartupReadinessRun, id: string): boolean {
  return run.phases.some((phase) => phase.id === id);
}

function shouldRunPhase(run: StartupReadinessRun, id: string): boolean {
  const phase = run.phases.find((candidate) => candidate.id === id);

  return phase !== undefined && phase.status !== "passed" && phase.status !== "skipped";
}

function collectRunEvidence(run: StartupReadinessRun): void {
  run.evidenceIds = unique(run.phases.flatMap((phase) => phase.evidenceIds));
  run.evidenceTiers = uniqueEvidenceTiers([
    ...run.evidenceTiers,
    ...inferPhaseEvidenceTiers(run)
  ]);
  run.reportPaths = unique([
    ...run.reportPaths,
    ...run.phases.flatMap((phase) => phase.artifacts).filter(isReportPath)
  ]);
}

function inferPhaseEvidenceTiers(
  run: Pick<StartupReadinessRun, "phases">
): StartupReadinessEvidenceTier[] {
  return uniqueEvidenceTiers(
    run.phases.flatMap((phase) => {
      if (phase.evidenceIds.length === 0) {
        return [];
      }

      if (phase.id === "verifiers") {
        return ["local_command"];
      }

      if (phase.id === "ui_smoke") {
        return ["synthetic_smoke"];
      }

      if (phase.id === "launch_audit") {
        return ["local_command", "security_scan"];
      }

      return [];
    })
  );
}

function isReportPath(path: string): boolean {
  return path.includes("/reports/") || path.endsWith(".md") || path.endsWith(".json");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueEvidenceTiers(
  values: StartupReadinessEvidenceTier[]
): StartupReadinessEvidenceTier[] {
  return [...new Set(values)];
}

function withStartupReadinessGuidance(run: StartupReadinessRun): StartupReadinessRun {
  const baseRun = {
    ...run,
    guidedFlow: [],
    operatorCommands: []
  };

  return {
    ...run,
    guidedFlow: buildStartupReadyGuidedFlow(baseRun),
    operatorCommands: buildStartupReadyOperatorCommands(baseRun)
  };
}

function startupReadyShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function parseStartupReadyStage(value: string): StartupReadyStage {
  if (
    value === "mvp" ||
    value === "launch" ||
    value === "scale" ||
    value === "complete"
  ) {
    return value;
  }

  throw new Error(`Unsupported startup ready stage ${value}`);
}

export function parseStartupReadyTarget(value: string): StartupReadyTarget {
  if (value === "local" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(`Unsupported startup ready target ${value}`);
}

export function parseStartupReadyGovernanceProfile(
  value: string
): StartupWorkerGovernanceProfile {
  if (value === "auto" || value === "readiness" || value === "governed") {
    return value;
  }

  throw new Error(`Unsupported startup ready governance profile ${value}`);
}

function planPhase(
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

interface StartupReadyDocsInspection {
  contextFiles: {
    existing: string[];
    stale: string[];
  };
  measurement: {
    exists: boolean;
    stale: boolean;
  };
}

async function inspectStartupReadyDocs(
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

function contextPlanNextAction(
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

function measurementPlanNextAction(
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

async function optionalStat(path: string): Promise<{ mtimeMs: number } | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

async function inspectStartupReadyDevServer(
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

async function inspectStartupReadyGate(
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

function packageManagerBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return inspection.packageManager.detected ? [] : ["package manager is missing"];
}

function verifierBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    inspection.commands.test.detected ? undefined : "test command is missing",
    inspection.commands.lint.detected ? undefined : "lint command is missing",
    inspection.commands.typecheck.detected ? undefined : "typecheck command is missing",
    inspection.commands.build.detected ? undefined : "build command is missing"
  ].filter((blocker): blocker is string => blocker !== undefined);
}

function hypothesisPlanBlockers(evidenceTypes: Set<string>): string[] {
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

function metricPlanBlockers(evidenceTypes: Set<string>): string[] {
  return evidenceTypes.has("startup_metric") ||
    evidenceTypes.has("startup_metric_snapshot")
    ? []
    : ["metric evidence is missing"];
}

function uiPlanBlockers(evidenceTypes: Set<string>): string[] {
  return evidenceTypes.has("startup_ui_validation")
    ? []
    : ["UI validation evidence is missing"];
}

function ciPlanBlockers(
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

function releasePlanBlockers(
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

function deploymentPlanBlockers(
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

function targetOperationalEvidencePlanBlockers(
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

function completePlanBlockers(evidenceTypes: Set<string>): string[] {
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

function phaseIncludedForStage(id: string, stage: StartupReadyStage): boolean {
  const mvp = new Set(["onboard", "context", "measurement", "build_mvp", "verifiers"]);
  const launch = new Set([
    ...mvp,
    "ui_smoke",
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

function startupReadinessRunsDir(root: string): string {
  return join(root, "startup", "readiness-runs");
}

async function collectStartupReadyCodeState(cwd: string): Promise<{
  gitHead?: string;
  dirtyState: StartupReadinessDirtyState;
  fingerprint: string;
}> {
  const codeState = await collectCommandVerifierCodeState(cwd);

  return {
    ...startupReadyGitHead(codeState),
    dirtyState: startupReadyDirtyState(codeState),
    fingerprint: codeState.fingerprint
  };
}

function startupReadyGitHead(codeState: CommandVerifierCodeState): {
  gitHead?: string;
} {
  if (!codeState.available) {
    return {};
  }

  return {
    gitHead: codeState.gitHead ?? "unborn"
  };
}

function startupReadyDirtyState(
  codeState: CommandVerifierCodeState
): StartupReadinessDirtyState {
  if (!codeState.available) {
    return "unknown";
  }

  return codeState.dirty ? "dirty" : "clean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
