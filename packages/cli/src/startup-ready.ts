import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { collectRepoInspection } from "./inspection-evidence.js";
import type { LocalAgentWorkerKind } from "./local-agent.js";
import { requireRunsteadStateDb, resolveRunsteadRoot } from "./runstead-root.js";
import { generateStartupCiSummary } from "./startup-ci-integration.js";
import { detectStartupDevServerCommand } from "./startup-dev-server.js";
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
} from "./startup-founder-flow.js";
import { generateStartupCompleteProductCheck } from "./startup-complete-check.js";
import {
  classifyStartupUiValidationFailure,
  executeStartupUiValidation,
  summarizeStartupUiValidationFailure,
  startupUiValidationRepairHint,
  type StartupUiFlowAction
} from "./startup-ui-validation.js";
import {
  addStartupEvidence,
  checkStartupGate,
  type StartupGateStage
} from "./startup-evidence.js";
import { supersedeStartupRemediationTasks } from "./startup-remediation.js";
import {
  evaluateStartupVerdict,
  type StartupVerdictResult
} from "./startup-verdict.js";

const execFileAsync = promisify(execFile);
const DEFAULT_UI_SMOKE_TIMEOUT_MS = 20_000;
const STARTUP_CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];
const STALE_STARTUP_DOC_DAYS = 30;

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
  maxAttempts?: number;
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
  runsteadInitialized: boolean;
  phases: StartupReadyPlanPhase[];
}

export interface StartupReadyPlanPhase {
  id: string;
  title: string;
  status: "pending" | "blocked" | "skipped";
  blockers: string[];
  nextAction?: string;
}

export interface StartupReadyUiSmokeConfig {
  schemaVersion: 1;
  server: StartupReadyUiSmokeServerConfig;
  checks: StartupReadyUiSmokeCheckConfig[];
}

export interface StartupReadyUiSmokeServerConfig {
  command: string;
  port: number;
  url?: string;
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeCheckConfig {
  name: string;
  url?: string;
  viewport?: string;
  expectText: string[];
  flow?: string;
  steps?: StartupUiFlowAction[];
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeRunResult {
  status: "passed" | "blocked";
  configPath: string;
  configStatus: "generated" | "loaded" | "blocked";
  configWarnings: string[];
  configRepairHints: string[];
  checks: StartupReadyUiSmokeCheckResult[];
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
}

export interface StartupReadyUiSmokeCheckResult {
  name: string;
  status: "passed" | "failed";
  evidenceId?: string;
  artifact?: string;
  failureCategory?: string;
  failureSummary?: string;
  repairHint?: string;
  blockers: string[];
}

export interface StartupReadinessRun {
  schemaVersion: 1;
  id: string;
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  status: StartupReadinessRunStatus;
  phases: StartupReadinessRunPhase[];
  evidenceIds: string[];
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
  verdict: StartupReadinessVerdict;
  verdictBlockers: string[];
  reportPaths: string[];
  startedAt: string;
  completedAt?: string;
  gitHead?: string;
  dirtyState: StartupReadinessDirtyState;
}

export interface StartupReadinessRunPhase {
  id: string;
  title: string;
  status: StartupReadinessPhaseStatus;
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
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
  const now = options.now ?? new Date();
  const [root, inspection, devServer, recordedEvidence, gate, docs] = await Promise.all(
    [
      resolveRunsteadRoot(cwd),
      collectRepoInspection(cwd, now.toISOString()),
      inspectStartupReadyDevServer(cwd),
      collectRecordedStartupReadinessEvidence(cwd),
      inspectStartupReadyGate(cwd, startupReadyStageToGateStage(stage), now),
      inspectStartupReadyDocs(cwd, now)
    ]
  );
  const evidenceTypes = new Set(recordedEvidence.evidenceTypes);
  const evidenceTiers = new Set(recordedEvidence.evidenceTiers);

  return {
    cwd,
    stage,
    target,
    worker,
    governanceProfile: governance.profile,
    runsteadInitialized: root.source !== "missing",
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
        ...targetOperationalEvidencePlanBlockers(evidenceTypes, evidenceTiers, target)
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

export async function createStartupReadinessRun(
  options: StartupReadyOptions = {}
): Promise<PersistedStartupReadinessRun> {
  const plan = await planStartupReady(options);
  const startedAt = (options.now ?? new Date()).toISOString();
  const git = await inspectGitState(plan.cwd);
  const run: StartupReadinessRun = {
    schemaVersion: 1,
    id: `run_${randomUUID().replaceAll("-", "")}`,
    cwd: plan.cwd,
    stage: plan.stage,
    target: plan.target,
    worker: plan.worker,
    governanceProfile: plan.governanceProfile,
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
    verdict: "not_evaluated",
    verdictBlockers: [],
    reportPaths: [],
    startedAt,
    ...(git.head === undefined ? {} : { gitHead: git.head }),
    dirtyState: git.dirtyState
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
    run: {
      ...parsed,
      governanceProfile: startupReadinessRunGovernanceProfile(parsed)
    },
    path
  };
}

export async function writeStartupReadinessRun(
  run: StartupReadinessRun
): Promise<PersistedStartupReadinessRun> {
  const root = await resolveRunsteadRoot(run.cwd);
  const dir = startupReadinessRunsDir(root.root);
  const path = join(dir, `${run.id}.json`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");

  return {
    run,
    path
  };
}

function startupReadinessRunGovernanceProfile(
  run: Pick<StartupReadinessRun, "worker"> & {
    governanceProfile?: ResolvedStartupWorkerGovernanceProfile;
  }
): ResolvedStartupWorkerGovernanceProfile {
  return (
    run.governanceProfile ?? (run.worker === "codex_direct" ? "governed" : "readiness")
  );
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
    `Runstead initialized: ${plan.runsteadInitialized ? "yes" : "no"}`,
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
  const guidedFlow = buildStartupReadyGuidedFlow(run);

  return [
    `Runstead startup readiness run: ${run.id}`,
    `Worker: ${run.worker}`,
    `Governance profile: ${startupReadinessRunGovernanceProfile(run)}`,
    formatStartupWorkerGovernanceNotice(
      run.worker,
      startupReadinessRunGovernanceProfile(run)
    ),
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
    updatePhase(run, "build_mvp", { status: "running" });
    await writeStartupReadinessRun(run);
    emitStartupReadyProgress(run, options, {
      phaseId: "build_mvp",
      status: "started",
      message: "running bounded MVP build or repair loop"
    });
    const build = await startupBuildMvp({
      cwd: run.cwd,
      worker: run.worker,
      dependencyPolicy: "deny-new",
      maxAttempts: options.maxAttempts ?? 2,
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const buildPhaseStatus = startupBuildMvpPhaseExecutionStatus(build.status);

    updatePhase(run, "build_mvp", {
      status: buildPhaseStatus,
      blockers:
        buildPhaseStatus === "passed"
          ? build.gate.blockers
          : [`worker finished with status ${build.status}`],
      nextAction:
        buildPhaseStatus === "passed"
          ? build.status === "completed_with_warnings"
            ? "review MVP worker warnings and continue launch readiness"
            : "review MVP gate blockers and continue launch readiness"
          : "review worker output and resume startup readiness"
    });
    updatePhase(run, "verifiers", verifierPhaseUpdate(build.verifierRun));
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
    const uiSmoke = await executeStartupReadyUiSmoke({
      cwd: run.cwd,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    updatePhase(run, "ui_smoke", {
      status: uiSmoke.status,
      evidenceIds: uiSmoke.evidenceIds,
      artifacts: uiSmoke.artifacts,
      blockers: uiSmoke.blockers,
      nextAction:
        uiSmoke.status === "passed"
          ? "continue launch readiness"
          : "fix UI smoke config or product flow and rerun startup ready"
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
    const complete = await generateStartupCompleteProductCheck({
      cwd: run.cwd,
      target: run.target,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    updatePhase(run, "complete_check", {
      status: complete.status === "complete" ? "passed" : "blocked",
      evidenceIds: [complete.evidenceId],
      artifacts: [complete.markdownPath, complete.jsonPath],
      blockers: complete.criteria.flatMap((criterion) => criterion.missing),
      nextAction:
        complete.status === "complete"
          ? "ship with recorded evidence"
          : "resolve complete-product missing evidence and rerun startup ready"
    });
    run.reportPaths = unique([
      ...run.reportPaths,
      complete.markdownPath,
      complete.jsonPath
    ]);
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
    emitStartupReadyPhaseResult(run, options, "complete_check");
  }
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

export async function executeStartupReadyUiSmoke(input: {
  cwd?: string;
  now?: Date;
}): Promise<StartupReadyUiSmokeRunResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const loaded = await loadOrCreateStartupReadyUiSmokeConfig(cwd);

  if (loaded.config === undefined) {
    return {
      status: "blocked",
      configPath: loaded.path,
      configStatus: "blocked",
      configWarnings: [],
      configRepairHints: [],
      checks: [],
      evidenceIds: [],
      artifacts: [],
      blockers: [loaded.blocker ?? "UI smoke config is missing"]
    };
  }

  const checks: StartupReadyUiSmokeCheckResult[] = [];

  for (const check of loaded.config.checks) {
    try {
      const url = check.url ?? loaded.config.server.url;
      const result = await executeStartupUiValidation({
        cwd,
        viewport: check.viewport ?? "desktop",
        serverCommand: loaded.config.server.command,
        serverPort: loaded.config.server.port,
        timeoutMs:
          check.timeoutMs ??
          loaded.config.server.timeoutMs ??
          DEFAULT_UI_SMOKE_TIMEOUT_MS,
        expectText: check.expectText,
        ...(check.steps === undefined ? {} : { flowActions: check.steps }),
        ...(url === undefined ? {} : { url }),
        ...(check.flow === undefined ? {} : { criticalFlow: check.flow }),
        ...(input.now === undefined ? {} : { now: input.now })
      });
      const failureSummary = result.failed
        ? summarizeStartupUiValidationFailure(result.execution)
        : undefined;
      const failureCategory = result.failed
        ? classifyStartupUiValidationFailure(result.execution)
        : undefined;
      const repairHint = result.failed
        ? startupUiValidationRepairHint(result.execution)
        : undefined;

      checks.push({
        name: check.name,
        status: result.failed ? "failed" : "passed",
        evidenceId: result.evidence.evidence.id,
        artifact: result.domArtifact,
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(failureSummary === undefined ? {} : { failureSummary }),
        ...(repairHint === undefined ? {} : { repairHint }),
        blockers: result.failed
          ? [
              `UI smoke check failed: ${check.name}: ${failureCategory ?? "unknown"}: ${failureSummary}; suggested patch: ${repairHint}`
            ]
          : []
      });
    } catch (error) {
      checks.push({
        name: check.name,
        status: "failed",
        blockers: [`UI smoke check failed: ${check.name}: ${errorMessage(error)}`]
      });
    }
  }

  const blockers = checks.flatMap((check) => check.blockers);
  const evidenceIds = checks
    .map((check) => check.evidenceId)
    .filter((id): id is string => id !== undefined);
  const artifacts = [
    loaded.path,
    ...checks
      .map((check) => check.artifact)
      .filter((artifact): artifact is string => artifact !== undefined)
  ];

  return {
    status: blockers.length === 0 ? "passed" : "blocked",
    configPath: loaded.path,
    configStatus: loaded.status,
    configWarnings: loaded.warnings,
    configRepairHints: loaded.repairHints,
    checks,
    evidenceIds,
    artifacts,
    blockers
  };
}

async function loadOrCreateStartupReadyUiSmokeConfig(cwd: string): Promise<
  | {
      path: string;
      status: "loaded" | "generated";
      config: StartupReadyUiSmokeConfig;
      warnings: string[];
      repairHints: string[];
    }
  | {
      path: string;
      status: "blocked";
      blocker: string;
      config?: undefined;
    }
> {
  const root = await resolveRunsteadRoot(cwd);
  const path = startupReadyUiSmokePath(root.root);
  const existing = await readOptionalTextFile(path);

  if (existing.trim().length > 0) {
    const loaded = parseStartupReadyUiSmokeConfig(existing, path);

    return {
      path,
      status: "loaded",
      config: loaded.config,
      warnings: loaded.warnings,
      repairHints: loaded.repairHints
    };
  }

  try {
    const command = await detectStartupDevServerCommand(cwd);
    const config = await defaultStartupReadyUiSmokeConfig(cwd, command);

    await mkdir(join(root.root, "startup"), { recursive: true });
    await writeFile(path, stringifyStartupReadyUiSmokeConfig(config), "utf8");

    return {
      path,
      status: "generated",
      config,
      warnings: [],
      repairHints: []
    };
  } catch (error) {
    return {
      path,
      status: "blocked",
      blocker: errorMessage(error)
    };
  }
}

async function defaultStartupReadyUiSmokeConfig(
  cwd: string,
  command: string
): Promise<StartupReadyUiSmokeConfig> {
  const expectText = await inferStartupReadyUiSmokeExpectText(cwd);
  const steps = await inferStartupReadyUiSmokeFlowActions(cwd);

  return {
    schemaVersion: 1,
    server: {
      command,
      port: 3000,
      url: "http://127.0.0.1:3000",
      timeoutMs: DEFAULT_UI_SMOKE_TIMEOUT_MS
    },
    checks: [
      {
        name: steps.length === 0 ? "home-desktop" : "home-desktop-product-flow",
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        expectText,
        flow:
          steps.length === 0
            ? "load the primary product route"
            : "todo golden path: add, toggle, search/filter, reload persistence",
        ...(steps.length === 0 ? {} : { steps })
      },
      {
        name: "home-mobile",
        url: "http://127.0.0.1:3000",
        viewport: "mobile",
        expectText,
        flow: "load the primary product route on mobile viewport"
      }
    ]
  };
}

export async function inferStartupReadyUiSmokeExpectText(
  cwd: string
): Promise<string[]> {
  const [packageText, htmlTexts, readmeTexts] = await Promise.all([
    inferExpectTextFromPackageJson(cwd),
    inferExpectTextFromHtmlFiles(cwd),
    inferExpectTextFromReadme(cwd)
  ]);

  const inferred = unique([...htmlTexts, ...readmeTexts, ...packageText]).slice(0, 6);

  return inferred.length === 0 ? ["html"] : inferred;
}

export async function inferStartupReadyUiSmokeFlowActions(
  cwd: string
): Promise<StartupUiFlowAction[]> {
  const signals = (
    await Promise.all([
      readOptionalTextFile(join(cwd, "package.json")),
      readOptionalTextFile(join(cwd, "README.md")),
      readOptionalTextFile(join(cwd, "index.html")),
      readOptionalTextFile(join(cwd, "src", "App.tsx")),
      readOptionalTextFile(join(cwd, "src", "App.jsx"))
    ])
  ).join("\n");

  if (!/\btodo\b|\btodos\b|\btask\b|\btasks\b/i.test(signals)) {
    return [];
  }

  const smokeTodo = "Runstead smoke todo";

  return [
    {
      type: "fill",
      selectors: [
        "[data-testid='new-todo-input']",
        "[data-testid='todo-input']",
        "[data-testid='new-task-input']",
        "[data-testid='task-input']",
        "#todo-input",
        "#task-input",
        "input[name='todo']",
        "input[name='task']",
        "input[aria-label*='add' i][aria-label*='todo' i]",
        "input[aria-label*='add' i][aria-label*='task' i]",
        "input[placeholder*='add' i][placeholder*='todo' i]",
        "input[placeholder*='add' i][placeholder*='task' i]",
        "input[placeholder*='todo' i]",
        "input[placeholder*='task' i]",
        "input[type='text']",
        "input:not([type])",
        "textarea"
      ],
      value: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='add-todo']",
        "[data-testid='add-task']",
        "button[type='submit']",
        "button:has-text('Add')",
        "text=Add"
      ]
    },
    {
      type: "expectText",
      text: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='todo-item'] input[type='checkbox']",
        "[data-testid='task-item'] input[type='checkbox']",
        "input[type='checkbox']",
        `text=${smokeTodo}`
      ]
    },
    {
      type: "fill",
      selectors: [
        "[data-testid='todo-search']",
        "[data-testid='task-search']",
        "#todo-search",
        "#task-search",
        "input[name='todo-search']",
        "input[name='task-search']",
        "input[name='search']",
        "input[aria-label*='search' i]",
        "input[placeholder*='search' i]",
        "input[type='search']"
      ],
      value: "Runstead"
    },
    {
      type: "expectText",
      text: smokeTodo
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-active']",
        "[aria-label*='active' i]",
        "button:has-text('Active')",
        "text=Active"
      ]
    },
    {
      type: "click",
      selectors: [
        "[data-testid='filter-all']",
        "[aria-label*='all' i]",
        "button:has-text('All')",
        "text=All"
      ]
    },
    {
      type: "expectPersisted",
      text: smokeTodo
    }
  ];
}

async function inferExpectTextFromPackageJson(cwd: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as unknown;

    if (!isRecord(parsed) || typeof parsed.name !== "string") {
      return [];
    }

    const displayName = packageNameToDisplayText(parsed.name);

    return displayName.length === 0 ? [] : [displayName];
  } catch {
    return [];
  }
}

async function inferExpectTextFromHtmlFiles(cwd: string): Promise<string[]> {
  const paths = [
    join(cwd, "index.html"),
    join(cwd, "public", "index.html"),
    join(cwd, "src", "index.html")
  ];
  const texts: string[] = [];

  for (const path of paths) {
    const contents = await readOptionalTextFile(path);

    if (contents.length === 0) {
      continue;
    }

    texts.push(...extractHtmlSignalText(contents));
  }

  return texts;
}

async function inferExpectTextFromReadme(cwd: string): Promise<string[]> {
  for (const name of ["README.md", "readme.md"]) {
    const contents = await readOptionalTextFile(join(cwd, name));
    const match = /^#\s+(.+)$/m.exec(contents);
    const heading = match?.[1]?.trim();

    if (heading !== undefined && heading.length > 0) {
      return [heading];
    }
  }

  return [];
}

function extractHtmlSignalText(contents: string): string[] {
  const texts: string[] = [];
  const patterns = [
    /<title[^>]*>([^<]+)<\/title>/gi,
    /<h1[^>]*>([^<]+)<\/h1>/gi,
    /<button[^>]*>([^<]+)<\/button>/gi,
    /aria-label=["']([^"']+)["']/gi,
    /placeholder=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      const text = normalizeUiText(match[1]);

      if (text !== undefined) {
        texts.push(text);
      }
    }
  }

  return texts;
}

function packageNameToDisplayText(name: string): string {
  const unscoped = name.includes("/") ? (name.split("/").pop() ?? name) : name;

  return unscoped
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeUiText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, " ").trim();

  return text === undefined || text.length === 0 ? undefined : text;
}

function stringifyStartupReadyUiSmokeConfig(config: StartupReadyUiSmokeConfig): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

function parseStartupReadyUiSmokeConfig(
  contents: string,
  path: string
): {
  config: StartupReadyUiSmokeConfig;
  warnings: string[];
  repairHints: string[];
} {
  const parsed = parseYaml(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`UI smoke config must be a YAML object: ${path}`);
  }

  const warnings: string[] = [];
  const repairHints: string[] = [];
  const server = startupReadyUiSmokeServerObject(parsed);
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  const usesLegacyStartupShape = isRecord(parsed.startup);
  const usesLegacyCheckShape = checks.some(
    (check) => isRecord(check) && (isRecord(check.request) || isRecord(check.expect))
  );

  if (usesLegacyStartupShape || usesLegacyCheckShape) {
    warnings.push("legacy UI smoke config shape was auto-normalized");
    repairHints.push(
      "Prefer schemaVersion/server.command/server.port/checks[].expectText for durable UI smoke configs."
    );
  }

  if (server === undefined) {
    throw new Error(`UI smoke config is missing server settings: ${path}`);
  }

  const command = stringValue(server.command);
  const url = stringValue(server.url);
  const port = numberValue(server.port) ?? portFromUrl(url);
  const timeoutMs = numberValue(server.timeoutMs);

  if (command === undefined || port === undefined) {
    throw new Error(
      `UI smoke config server.command and server.port are required: ${path}`
    );
  }

  if (checks.length === 0) {
    throw new Error(`UI smoke config requires at least one check: ${path}`);
  }

  return {
    config: {
      schemaVersion: 1,
      server: {
        command,
        port,
        ...(url === undefined ? {} : { url }),
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      },
      checks: checks.flatMap((check, index) =>
        parseStartupReadyUiSmokeCheck(check, index, path)
      )
    },
    warnings,
    repairHints
  };
}

function startupReadyUiSmokeServerObject(
  parsed: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (isRecord(parsed.server)) {
    return parsed.server;
  }

  const startup = isRecord(parsed.startup) ? parsed.startup : undefined;

  if (startup === undefined) {
    return undefined;
  }

  const readyWhen = isRecord(startup.readyWhen) ? startup.readyWhen : undefined;

  return {
    command: startup.run,
    url: readyWhen?.url,
    port: readyWhen?.port,
    timeoutMs: startup.timeoutMs ?? readyWhen?.timeoutMs
  };
}

function parseStartupReadyUiSmokeCheck(
  input: unknown,
  index: number,
  path: string
): StartupReadyUiSmokeCheckConfig[] {
  if (!isRecord(input)) {
    throw new Error(`UI smoke check ${index + 1} must be an object: ${path}`);
  }

  const name = stringValue(input.name) ?? `check-${index + 1}`;
  const legacyRequest = isRecord(input.request) ? input.request : undefined;
  const legacyExpect = isRecord(input.expect) ? input.expect : undefined;
  const expectText = [
    ...arrayOfStrings(input.expectText),
    ...arrayOfStrings(input.expect),
    ...arrayOfStrings(legacyExpect?.bodyContains),
    ...arrayOfStrings(legacyExpect?.expectText),
    ...arrayOfStrings(legacyExpect?.text)
  ];
  const url = stringValue(input.url) ?? stringValue(legacyRequest?.url);
  const viewport = stringValue(input.viewport);
  const viewports = unique([
    ...(viewport === undefined ? [] : [viewport]),
    ...arrayOfStrings(input.viewports)
  ]);
  const parsedFlowSteps = parseStartupReadyUiSmokeSteps(input.steps ?? input.flow);
  const flow =
    typeof input.flow === "string"
      ? input.flow
      : (stringValue(input.description) ??
        (parsedFlowSteps.length === 0
          ? undefined
          : "configured UI smoke interaction flow"));
  const timeoutMs = numberValue(input.timeoutMs);

  const base = {
    name,
    ...(url === undefined ? {} : { url }),
    expectText,
    ...(flow === undefined ? {} : { flow }),
    ...(parsedFlowSteps.length === 0 ? {} : { steps: parsedFlowSteps }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  };

  if (viewports.length === 0) {
    return [base];
  }

  return viewports.map((item) => ({
    ...base,
    name: viewports.length === 1 ? name : `${name}-${uiSmokeViewportSlug(item)}`,
    viewport: item
  }));
}

function uiSmokeViewportSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length === 0 ? "viewport" : slug;
}

function parseStartupReadyUiSmokeSteps(value: unknown): StartupUiFlowAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => parseStartupReadyUiSmokeStep(item, index));
}

function parseStartupReadyUiSmokeStep(
  value: unknown,
  index: number
): StartupUiFlowAction {
  if (!isRecord(value)) {
    throw new Error(`UI smoke flow step ${index + 1} must be an object`);
  }

  const type = stringValue(value.type);
  const normalized =
    type === undefined && Object.keys(value).length === 1
      ? keyedFlowAction(value)
      : value;
  const normalizedType = stringValue(normalized.type);

  switch (normalizedType) {
    case "fill":
      return {
        type: "fill",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke fill ${index + 1}`)
      };
    case "select":
      return {
        type: "select",
        ...flowSelectors(normalized),
        value: requiredStringValue(normalized.value, `UI smoke select ${index + 1}`)
      };
    case "click":
      return {
        type: "click",
        ...flowSelectors(normalized)
      };
    case "expectText":
      return {
        type: "expectText",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectText ${index + 1}`
        )
      };
    case "expectCount":
      return {
        type: "expectCount",
        selector: requiredStringValue(
          normalized.selector,
          `UI smoke expectCount selector ${index + 1}`
        ),
        count: requiredNumberValue(
          normalized.count,
          `UI smoke expectCount count ${index + 1}`
        )
      };
    case "reload":
      return {
        type: "reload"
      };
    case "expectPersisted":
      return {
        type: "expectPersisted",
        text: requiredStringValue(
          normalized.text ?? normalized.value,
          `UI smoke expectPersisted ${index + 1}`
        ),
        ...flowSelectors(normalized)
      };
    default:
      throw new Error(
        `Unsupported UI smoke flow step ${index + 1}: ${String(normalizedType)}`
      );
  }
}

function keyedFlowAction(value: Record<string, unknown>): Record<string, unknown> {
  const [type, payload] = Object.entries(value)[0] ?? [];

  return isRecord(payload) ? { type, ...payload } : { type, value: payload };
}

function flowSelectors(value: Record<string, unknown>): {
  selector?: string;
  selectors?: string[];
} {
  return {
    ...(typeof value.selector === "string" ? { selector: value.selector } : {}),
    ...(!Array.isArray(value.selectors)
      ? {}
      : { selectors: arrayOfStrings(value.selectors) })
  };
}

function requiredStringValue(value: unknown, label: string): string {
  const parsed = stringValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return parsed;
}

function requiredNumberValue(value: unknown, label: string): number {
  const parsed = numberValue(value);

  if (parsed === undefined) {
    throw new Error(`${label} must be a number`);
  }

  return parsed;
}

function portFromUrl(url: string | undefined): number | undefined {
  if (url === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(url);

    if (parsed.port.length > 0) {
      return Number(parsed.port);
    }

    if (parsed.protocol === "http:") {
      return 80;
    }

    if (parsed.protocol === "https:") {
      return 443;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function ensureStartupReadyLocalMvpEvidence(
  run: StartupReadinessRun,
  now: Date
): Promise<void> {
  const evidenceTypes = new Set(
    (await collectRecordedStartupReadinessEvidence(run.cwd)).evidenceTypes
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
    (await collectRecordedStartupReadinessEvidence(run.cwd)).evidenceTypes
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
      confidence: "local_command",
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

type StartupBuildMvpResultStatus = Awaited<
  ReturnType<typeof startupBuildMvp>
>["status"];

export function startupBuildMvpPhaseExecutionStatus(
  status: StartupBuildMvpResultStatus
): "passed" | "failed" {
  return status === "completed" || status === "completed_with_warnings"
    ? "passed"
    : "failed";
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
  const recordedEvidence = await collectRecordedStartupReadinessEvidence(run.cwd);
  const evidenceTiers = uniqueEvidenceTiers([
    ...inferPhaseEvidenceTiers(run),
    ...recordedEvidence.evidenceTiers,
    ...(options.extraEvidenceTiers ?? [])
  ]);
  const verdict = evaluateStartupReadinessVerdict({
    run,
    evidenceTiers,
    evidenceTypes: recordedEvidence.evidenceTypes
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
    evidenceTypes: run.evidenceTypes
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
      status: run.status,
      verdict: run.verdict,
      verdictBlockers: run.verdictBlockers,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      gitHead: run.gitHead,
      dirtyState: run.dirtyState
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
    decisions,
    evidence: {
      ids: run.evidenceIds,
      tiers: run.evidenceTiers,
      types: run.evidenceTypes,
      phaseEvidence: run.phases.map((phase) => ({
        phase: phase.id,
        status: phase.status,
        evidenceIds: phase.evidenceIds,
        artifacts: phase.artifacts,
        blockers: phase.blockers
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
    evidenceTypes: input.run.evidenceTypes
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
    status: StartupReadinessRunStatus;
    verdict: StartupReadinessVerdict;
    verdictBlockers: string[];
    startedAt: string;
    completedAt: string | undefined;
    gitHead: string | undefined;
    dirtyState: StartupReadinessDirtyState;
  };
  decisions: {
    localDemo: StartupReadinessDecision;
    privateBeta: StartupReadinessDecision;
    publicLaunch: StartupReadinessDecision;
  };
  targetBoundary: StartupReadinessTargetBoundary;
  guidedFlow: StartupReadyGuidedStep[];
  evidence: {
    ids: string[];
    tiers: StartupReadinessEvidenceTier[];
    types: string[];
    phaseEvidence: {
      phase: string;
      status: StartupReadinessPhaseStatus;
      evidenceIds: string[];
      artifacts: string[];
      blockers: string[];
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
    `- Started: ${input.run.startedAt}`,
    `- Completed: ${input.run.completedAt ?? "not completed"}`,
    `- Evidence tiers: ${input.evidence.tiers.length === 0 ? "none" : input.evidence.tiers.join(", ")}`,
    `- Evidence types: ${input.evidence.types.length === 0 ? "none" : input.evidence.types.join(", ")}`,
    `- Evidence ids: ${input.evidence.ids.length === 0 ? "none" : input.evidence.ids.join(", ")}`,
    "",
    "## Phase Evidence",
    "",
    "| Phase | Status | Evidence | Artifacts | Blockers |",
    "| --- | --- | --- | --- | --- |",
    ...input.evidence.phaseEvidence.map(
      (phase) =>
        `| ${phase.phase} | ${phase.status} | ${phase.evidenceIds.length === 0 ? "none" : phase.evidenceIds.join(", ")} | ${phase.artifacts.length === 0 ? "none" : phase.artifacts.join("<br>")} | ${phase.blockers.length === 0 ? "none" : phase.blockers.join("<br>")} |`
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
}): StartupVerdictResult {
  return evaluateStartupVerdict({
    target: input.run.target,
    phases: input.run.phases,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes ?? []
  });
}

async function collectRecordedStartupReadinessEvidence(cwd: string): Promise<{
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
}> {
  try {
    const state = await requireRunsteadStateDb(cwd);
    const database = openRunsteadDatabase(state.stateDb);

    try {
      const rows = database
        .prepare(
          `
          SELECT type, uri, summary
          FROM evidence
          WHERE type = 'command_output' OR type LIKE 'startup_%'
          `
        )
        .all() as unknown as StartupReadinessEvidenceRow[];
      const artifacts = await Promise.all(
        rows.map((row) => readStartupReadinessEvidenceArtifact(row.uri))
      );

      return {
        evidenceTiers: uniqueEvidenceTiers(
          rows.flatMap((row, index) =>
            inferRecordedEvidenceTiers(row, artifacts[index])
          )
        ),
        evidenceTypes: unique(rows.map((row) => row.type))
      };
    } finally {
      database.close();
    }
  } catch {
    return {
      evidenceTiers: [],
      evidenceTypes: []
    };
  }
}

interface StartupReadinessEvidenceRow {
  type: string;
  uri: string;
  summary?: string | null;
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
    blockers: update.blockers ?? phase.blockers
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

function startupReadyUiSmokePath(root: string): string {
  return join(root, "startup", "ui-smoke.yaml");
}

function startupReadinessRunsDir(root: string): string {
  return join(root, "startup", "readiness-runs");
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function inspectGitState(
  cwd: string
): Promise<{ head?: string; dirtyState: StartupReadinessDirtyState }> {
  try {
    const [head, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd,
        encoding: "utf8",
        timeout: 5_000
      }),
      execFileAsync("git", ["status", "--short"], {
        cwd,
        encoding: "utf8",
        timeout: 5_000
      })
    ]);

    return {
      head: head.stdout.trim(),
      dirtyState: status.stdout.trim().length === 0 ? "clean" : "dirty"
    };
  } catch {
    return {
      dirtyState: "unknown"
    };
  }
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

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
