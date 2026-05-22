import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { collectRepoInspection } from "./inspection-evidence.js";
import type { LocalAgentWorkerKind } from "./local-agent.js";
import { requireRunsteadStateDb, resolveRunsteadRoot } from "./runstead-root.js";
import { detectStartupDevServerCommand } from "./startup-dev-server.js";
import {
  startupBuildMvp,
  startupLaunchCheck,
  startupOnboard,
  startupScaleCheck,
  type StartupBuildMvpOptions
} from "./startup-founder-flow.js";
import { generateStartupCompleteProductCheck } from "./startup-complete-check.js";
import { executeStartupUiValidation } from "./startup-ui-validation.js";

const execFileAsync = promisify(execFile);
const DEFAULT_UI_SMOKE_TIMEOUT_MS = 20_000;

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
  plan?: boolean;
  resumeRunId?: string;
  writeCi?: boolean;
  ci?: boolean;
  maxAttempts?: number;
  workerRunner?: StartupBuildMvpOptions["workerRunner"];
  now?: Date;
}

export interface StartupReadyPlan {
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
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
  timeoutMs?: number;
}

export interface StartupReadyUiSmokeRunResult {
  status: "passed" | "blocked";
  configPath: string;
  configStatus: "generated" | "loaded" | "blocked";
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
  blockers: string[];
}

export interface StartupReadinessRun {
  schemaVersion: 1;
  id: string;
  cwd: string;
  stage: StartupReadyStage;
  target: StartupReadyTarget;
  worker: LocalAgentWorkerKind;
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
  const worker = options.worker ?? "codex_cli";
  const now = options.now ?? new Date();
  const [root, inspection] = await Promise.all([
    resolveRunsteadRoot(cwd),
    collectRepoInspection(cwd, now.toISOString())
  ]);

  return {
    cwd,
    stage,
    target,
    worker,
    runsteadInitialized: root.source !== "missing",
    phases: [
      planPhase("onboard", "Onboard repo", root.source === "missing" ? [] : []),
      planPhase("context", "Generate context", []),
      planPhase("measurement", "Measurement framework", []),
      planPhase("build_mvp", "Build or repair MVP", []),
      planPhase("verifiers", "Run verifiers", verifierBlockers(inspection)),
      planPhase("ui_smoke", "UI smoke", []),
      planPhase("launch_audit", "Launch audit/security", []),
      planPhase("launch_report", "Launch report", []),
      planPhase("complete_check", "Complete product check", [])
    ].filter((phase) => phaseIncludedForStage(phase.id, stage))
  };
}

export async function runStartupReady(
  options: StartupReadyOptions = {}
): Promise<RunStartupReadyResult> {
  const plan = await planStartupReady(options);
  const persisted = await createStartupReadinessRun(options);
  const run = {
    ...persisted.run,
    status: "running" as const
  };

  await writeStartupReadinessRun(run);

  try {
    await executeStartupReadyRun(run, options);
  } catch (error) {
    const failedRun = {
      ...run,
      status: "failed" as const,
      completedAt: (options.now ?? new Date()).toISOString()
    };

    await writeStartupReadinessRun(failedRun);
    throw error;
  }

  const finalRun = await finalizeRun(run, options.now ?? new Date());
  const reportedRun = await writeStartupReadinessDecisionReport(
    finalRun,
    options.now ?? new Date()
  );
  const finalPersisted = await writeStartupReadinessRun(reportedRun);

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
    run: parsed,
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

export function formatStartupReadyPlan(plan: StartupReadyPlan): string {
  return [
    "Startup readiness plan",
    `Workspace: ${plan.cwd}`,
    `Stage: ${plan.stage}`,
    `Target: ${plan.target}`,
    `Worker: ${plan.worker}`,
    `Runstead initialized: ${plan.runsteadInitialized ? "yes" : "no"}`,
    "",
    "Phases:",
    ...plan.phases.map(
      (phase, index) =>
        `${index + 1}. ${phase.title}: ${phase.status}${phase.blockers.length === 0 ? "" : ` (${phase.blockers.join("; ")})`}`
    )
  ].join("\n");
}

export function formatStartupReadinessRun(run: StartupReadinessRun): string {
  return [
    `Runstead startup readiness run: ${run.id}`,
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
    `Dirty state: ${run.dirtyState}`
  ].join("\n");
}

async function executeStartupReadyRun(
  run: StartupReadinessRun,
  options: StartupReadyOptions
): Promise<void> {
  if (hasPhase(run, "onboard")) {
    updatePhase(run, "onboard", { status: "running" });
    await writeStartupReadinessRun(run);
    const onboard = await startupOnboard({
      cwd: run.cwd,
      writeCi: options.writeCi === true,
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
  }

  if (hasPhase(run, "build_mvp")) {
    updatePhase(run, "build_mvp", { status: "running" });
    await writeStartupReadinessRun(run);
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

    updatePhase(run, "build_mvp", {
      status: build.status === "completed" ? "passed" : "failed",
      blockers:
        build.status === "completed"
          ? build.gate.blockers
          : [`worker finished with status ${build.status}`],
      nextAction:
        build.status === "completed"
          ? "review MVP gate blockers and continue launch readiness"
          : "review worker output and resume startup readiness"
    });
    updatePhase(run, "verifiers", verifierPhaseUpdate(build.verifierRun));
    collectRunEvidence(run);
    await writeStartupReadinessRun(run);
  }

  if (hasPhase(run, "ui_smoke")) {
    updatePhase(run, "ui_smoke", { status: "running" });
    await writeStartupReadinessRun(run);
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
  }

  if (hasPhase(run, "launch_audit") || hasPhase(run, "launch_report")) {
    updatePhase(run, "launch_audit", { status: "running" });
    updatePhase(run, "launch_report", { status: "running" });
    await writeStartupReadinessRun(run);
    const launch = await startupLaunchCheck({
      cwd: run.cwd,
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
  }

  if (run.stage === "scale") {
    await startupScaleCheck({
      cwd: run.cwd,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  if (hasPhase(run, "complete_check")) {
    updatePhase(run, "complete_check", { status: "running" });
    await writeStartupReadinessRun(run);
    const complete = await generateStartupCompleteProductCheck({
      cwd: run.cwd,
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
  }
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
        ...(url === undefined ? {} : { url }),
        ...(check.flow === undefined ? {} : { criticalFlow: check.flow }),
        ...(input.now === undefined ? {} : { now: input.now })
      });

      checks.push({
        name: check.name,
        status: result.failed ? "failed" : "passed",
        evidenceId: result.evidence.evidence.id,
        artifact: result.domArtifact,
        blockers: result.failed ? [`UI smoke check failed: ${check.name}`] : []
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
    return {
      path,
      status: "loaded",
      config: parseStartupReadyUiSmokeConfig(existing, path)
    };
  }

  try {
    const command = await detectStartupDevServerCommand(cwd);
    const config = defaultStartupReadyUiSmokeConfig(command);

    await mkdir(join(root.root, "startup"), { recursive: true });
    await writeFile(path, stringifyStartupReadyUiSmokeConfig(config), "utf8");

    return {
      path,
      status: "generated",
      config
    };
  } catch (error) {
    return {
      path,
      status: "blocked",
      blocker: errorMessage(error)
    };
  }
}

function defaultStartupReadyUiSmokeConfig(command: string): StartupReadyUiSmokeConfig {
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
        name: "home",
        url: "http://127.0.0.1:3000",
        viewport: "desktop",
        expectText: [],
        flow: "load the primary product route"
      }
    ]
  };
}

function stringifyStartupReadyUiSmokeConfig(config: StartupReadyUiSmokeConfig): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

function parseStartupReadyUiSmokeConfig(
  contents: string,
  path: string
): StartupReadyUiSmokeConfig {
  const parsed = parseYaml(contents) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`UI smoke config must be a YAML object: ${path}`);
  }

  const server = isRecord(parsed.server) ? parsed.server : undefined;
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];

  if (server === undefined) {
    throw new Error(`UI smoke config is missing server settings: ${path}`);
  }

  const command = stringValue(server.command);
  const port = numberValue(server.port);
  const url = stringValue(server.url);
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
    schemaVersion: 1,
    server: {
      command,
      port,
      ...(url === undefined ? {} : { url }),
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    },
    checks: checks.map((check, index) =>
      parseStartupReadyUiSmokeCheck(check, index, path)
    )
  };
}

function parseStartupReadyUiSmokeCheck(
  input: unknown,
  index: number,
  path: string
): StartupReadyUiSmokeCheckConfig {
  if (!isRecord(input)) {
    throw new Error(`UI smoke check ${index + 1} must be an object: ${path}`);
  }

  const name = stringValue(input.name) ?? `check-${index + 1}`;
  const expectText = arrayOfStrings(input.expectText);
  const url = stringValue(input.url);
  const viewport = stringValue(input.viewport);
  const flow = stringValue(input.flow);
  const timeoutMs = numberValue(input.timeoutMs);

  return {
    name,
    ...(url === undefined ? {} : { url }),
    ...(viewport === undefined ? {} : { viewport }),
    expectText,
    ...(flow === undefined ? {} : { flow }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
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

async function finalizeRun(
  run: StartupReadinessRun,
  now: Date
): Promise<StartupReadinessRun> {
  const recordedEvidence = await collectRecordedStartupReadinessEvidence(run.cwd);
  const evidenceTiers = uniqueEvidenceTiers([
    ...inferPhaseEvidenceTiers(run),
    ...recordedEvidence.evidenceTiers
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
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    run: {
      id: run.id,
      cwd: run.cwd,
      stage: run.stage,
      target: run.target,
      status: run.status,
      verdict: run.verdict,
      verdictBlockers: run.verdictBlockers,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      gitHead: run.gitHead,
      dirtyState: run.dirtyState
    },
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

function formatStartupReadinessDecisionMarkdown(input: {
  generatedAt: string;
  run: {
    id: string;
    cwd: string;
    stage: StartupReadyStage;
    target: StartupReadyTarget;
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
}): { verdict: StartupReadinessVerdict; blockers: string[] } {
  const phaseBlockers = input.run.phases
    .filter((phase) => phase.status === "blocked" || phase.status === "failed")
    .map((phase) => `${phase.title} is ${phase.status}`);
  const tierBlockers = missingStartupReadinessEvidenceBlockers({
    target: input.run.target,
    phases: input.run.phases,
    evidenceTiers: input.evidenceTiers,
    evidenceTypes: input.evidenceTypes ?? []
  });
  const blockers = unique([...phaseBlockers, ...tierBlockers]);
  const ready = blockers.length === 0;

  if (input.run.target === "local") {
    return {
      verdict: ready ? "local_launch_ready" : "local_launch_blocked",
      blockers
    };
  }

  if (input.run.target === "staging") {
    return {
      verdict: ready ? "staging_launch_ready" : "staging_launch_blocked",
      blockers
    };
  }

  return {
    verdict: ready ? "public_launch_ready" : "public_launch_blocked",
    blockers
  };
}

function missingStartupReadinessEvidenceBlockers(input: {
  target: StartupReadyTarget;
  phases: StartupReadinessRunPhase[];
  evidenceTiers: StartupReadinessEvidenceTier[];
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

  if (!evidenceTypes.has("startup_observability")) {
    blockers.push("observability evidence is required");
  }

  return blockers;
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

function hasPhase(run: StartupReadinessRun, id: string): boolean {
  return run.phases.some((phase) => phase.id === id);
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

function planPhase(
  id: string,
  title: string,
  blockers: string[]
): StartupReadyPlanPhase {
  return {
    id,
    title,
    status: blockers.length === 0 ? "pending" : "blocked",
    blockers
  };
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

function phaseIncludedForStage(id: string, stage: StartupReadyStage): boolean {
  const mvp = new Set(["onboard", "context", "measurement", "build_mvp", "verifiers"]);
  const launch = new Set([...mvp, "ui_smoke", "launch_audit", "launch_report"]);
  const scale = new Set([...launch]);
  const complete = new Set([...launch, "complete_check"]);

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
