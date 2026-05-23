import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createLocalAgentTask,
  runLocalAgentTask,
  type LocalAgentWorkerKind,
  type RunLocalAgentTaskOptions,
  type RunLocalAgentTaskResult
} from "./local-agent.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import type { InitPolicyProfile } from "./init.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import {
  generateMeasurementFramework,
  generateRepoReadinessAudit,
  generateScaleOpsReport,
  generateSecurityBaseline,
  generateStartupContext,
  initStartup,
  type GenerateMeasurementFrameworkResult,
  type GenerateRepoReadinessAuditResult,
  type GenerateScaleOpsReportResult,
  type GenerateSecurityBaselineResult,
  type GenerateStartupContextResult,
  type StartupInitResult
} from "./startup-automation.js";
import { checkStartupGate, type StartupGateCheckResult } from "./startup-evidence.js";
import {
  formatStartupRepoOnboarding,
  prepareStartupRepoOnboarding,
  type StartupRepoOnboardingResult
} from "./startup-repo-onboarding.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface StartupFounderFlowOptions {
  cwd?: string;
  profile?: InitPolicyProfile;
  force?: boolean;
  writeCi?: boolean;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
  now?: Date;
}

export interface StartupOnboardResult {
  root: string;
  repo: StartupRepoOnboardingResult;
  init: StartupInitResult;
  context: StartupGeneratedStep<GenerateStartupContextResult>;
  measurement: StartupGeneratedStep<GenerateMeasurementFrameworkResult>;
  onboardingFiles: string[];
  nextCommands: string[];
}

export interface StartupBuildMvpOptions extends StartupFounderFlowOptions {
  worker?: LocalAgentWorkerKind;
  model?: string;
  prompt?: string;
  dependencyPolicy?: string;
  allowedDependencies?: string[];
  maxAttempts?: number;
  maxTurns?: number;
  workerRunner?: WorkerProcessRunner;
  onWorkerProgress?: RunLocalAgentTaskOptions["onWorkerProgress"];
  workerProgressIntervalMs?: number;
}

export interface StartupBuildMvpResult {
  root: string;
  worker: LocalAgentWorkerKind;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  maxTurns: number;
  dependencyApproval: StartupDependencyApprovalBoundary;
  verifierRun: StartupMvpVerifierRun;
  attempts: StartupBuildMvpAttempt[];
  gate: StartupGateCheckResult;
  nextCommands: string[];
}

export interface StartupBuildMvpAttempt {
  attempt: number;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  verifierRun: StartupMvpVerifierRun;
}

export type StartupDependencyApprovalPolicy =
  | "approval-required"
  | "allow-listed"
  | "deny-new";

export interface StartupDependencyApprovalBoundary {
  policy: StartupDependencyApprovalPolicy;
  allowedDependencies: string[];
  approvalRequired: string[];
  workerInstruction: string;
}

export interface StartupLaunchCheckResult {
  root: string;
  readiness: GenerateRepoReadinessAuditResult;
  security: GenerateSecurityBaselineResult;
  gate: StartupGateCheckResult;
  reportPath: string;
  status: "launch_ready" | "blocked";
  blockers: string[];
  nextCommands: string[];
}

export interface StartupScaleCheckResult {
  root: string;
  opsReport: GenerateScaleOpsReportResult;
  gate: StartupGateCheckResult;
  nextCommands: string[];
}

export interface StartupGeneratedStep<T> {
  status: "generated" | "skipped";
  result?: T;
  reason?: string;
}

export type StartupMvpVerifierRun =
  | {
      status: StartupMvpVerifierTaskStatus;
      taskId: string;
      commandResults: RunTaskVerifierCommandResult[];
    }
  | {
      status: "skipped";
      reason: string;
    };

type StartupMvpVerifierTaskStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "waiting_approval";

const DEFAULT_STARTUP_BUILD_MVP_MAX_TURNS = 24;

export async function startupOnboard(
  options: StartupFounderFlowOptions = {}
): Promise<StartupOnboardResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const repo = await prepareStartupRepoOnboarding({
    cwd,
    writeGitignore: true,
    writeCi: options.writeCi === true,
    force: options.force === true,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const init = await initStartup({
    cwd,
    stage: "mvp",
    profile: options.profile ?? "trusted-local",
    force: options.force === true,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const context = await generatedStep(() =>
    generateStartupContext({
      cwd,
      force: options.force === true,
      ...(options.architecturePrinciples === undefined
        ? {}
        : { architecturePrinciples: options.architecturePrinciples }),
      ...(options.technicalConstraints === undefined
        ? {}
        : { technicalConstraints: options.technicalConstraints }),
      ...(options.acceptedDebt === undefined
        ? {}
        : { acceptedDebt: options.acceptedDebt }),
      ...(options.now === undefined ? {} : { now: options.now })
    })
  );
  const measurement = await generatedStep(() =>
    generateMeasurementFramework({
      cwd,
      force: options.force === true,
      ...(options.activationMetric === undefined
        ? {}
        : { activationMetric: options.activationMetric }),
      ...(options.retentionMetric === undefined
        ? {}
        : { retentionMetric: options.retentionMetric }),
      ...(options.day7Metric === undefined ? {} : { day7Metric: options.day7Metric }),
      ...(options.day30Metric === undefined
        ? {}
        : { day30Metric: options.day30Metric }),
      ...(options.falsePositiveMetric === undefined
        ? {}
        : { falsePositiveMetric: options.falsePositiveMetric }),
      ...(options.now === undefined ? {} : { now: options.now })
    })
  );
  const nextCommands = [
    "runstead startup build-mvp --worker codex_cli",
    "runstead startup launch-check",
    "runstead startup remediate --stage launch --execute --worker codex_cli"
  ];
  const onboardingFiles = await writeStartupOnboardingFiles({
    root: init.root,
    repo,
    nextCommands,
    generatedAt: (options.now ?? new Date()).toISOString()
  });

  return {
    root: init.root,
    repo,
    init,
    context,
    measurement,
    onboardingFiles,
    nextCommands
  };
}

export async function startupBuildMvp(
  options: StartupBuildMvpOptions = {}
): Promise<StartupBuildMvpResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const worker = options.worker ?? "codex_cli";
  const maxAttempts = normalizeStartupBuildMvpMaxAttempts(options.maxAttempts);
  const maxTurns = normalizeStartupBuildMvpMaxTurns(options.maxTurns);
  const dependencyApproval = resolveStartupDependencyApprovalBoundary({
    ...(options.dependencyPolicy === undefined
      ? {}
      : { policy: options.dependencyPolicy }),
    allowedDependencies: options.allowedDependencies ?? []
  });
  const basePrompt = await startupBuildMvpPromptWithDependencyBoundary({
    cwd,
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    dependencyApproval
  });
  const init = await initStartup({
    cwd,
    stage: "mvp",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const attempts: StartupBuildMvpAttempt[] = [];
  let prompt = basePrompt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const created = await createLocalAgentTask({
      cwd,
      title:
        maxAttempts === 1
          ? "Build startup MVP"
          : `Build startup MVP (attempt ${attempt}/${maxAttempts})`,
      prompt,
      worker,
      mode: "repair",
      checkpoint: true,
      approvalRequired: dependencyApproval.approvalRequired,
      verifierCommands: await verifierCommands(cwd, options.now),
      maxTurns,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const run = await runLocalAgentTask({
      cwd,
      taskId: created.task.id,
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.workerProgressIntervalMs === undefined
        ? {}
        : { workerProgressIntervalMs: options.workerProgressIntervalMs }),
      ...(options.onWorkerProgress === undefined
        ? {}
        : { onWorkerProgress: options.onWorkerProgress }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const verifierRun = verifierRunFromLocalAgentRun(run);
    const currentAttempt: StartupBuildMvpAttempt = {
      attempt,
      localAgentTaskId: created.task.id,
      status: run.status,
      summary: run.summary,
      verifierRun
    };

    attempts.push(currentAttempt);

    if (
      (run.status !== "completed" && verifierRun.status === "skipped") ||
      startupMvpVerifierRunPassed(verifierRun) ||
      attempt === maxAttempts
    ) {
      break;
    }

    prompt = startupBuildMvpRetryPrompt({
      basePrompt,
      attempt,
      maxAttempts,
      verifierRun
    });
  }

  const finalAttempt = attempts.at(-1);

  if (finalAttempt === undefined) {
    throw new Error("Startup MVP build did not run any attempts");
  }

  const gate = await checkStartupGate({
    cwd,
    stage: "mvp",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: init.root,
    worker,
    localAgentTaskId: finalAttempt.localAgentTaskId,
    status: finalAttempt.status,
    summary: finalAttempt.summary,
    maxTurns,
    dependencyApproval,
    verifierRun: finalAttempt.verifierRun,
    attempts,
    gate,
    nextCommands: [
      "runstead startup launch-check",
      "runstead startup remediate --stage launch --execute --worker codex_cli"
    ]
  };
}

export async function startupLaunchCheck(
  options: StartupFounderFlowOptions = {}
): Promise<StartupLaunchCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  await initStartup({
    cwd,
    stage: "launch",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const readiness = await generateRepoReadinessAudit({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const security = await generateSecurityBaseline({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const gate = await checkStartupGate({
    cwd,
    stage: "launch",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const report = await generateLaunchReadinessReport({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: readiness.root,
    readiness,
    security,
    gate,
    reportPath: report.reportPath,
    status: report.status,
    blockers: report.blockers,
    nextCommands:
      report.status === "launch_ready"
        ? ["runstead startup scale-check"]
        : ["runstead startup remediate --stage launch --execute --worker codex_cli"]
  };
}

export async function startupScaleCheck(
  options: StartupFounderFlowOptions = {}
): Promise<StartupScaleCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  await initStartup({
    cwd,
    stage: "scale",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const opsReport = await generateScaleOpsReport({
    cwd,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const gate = await checkStartupGate({
    cwd,
    stage: "scale",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: opsReport.root,
    opsReport,
    gate,
    nextCommands: gate.passed
      ? ["runstead startup scale report"]
      : ["runstead startup remediate --stage scale --execute --worker codex_cli"]
  };
}

export function formatStartupOnboard(result: StartupOnboardResult): string {
  return [
    "Startup onboard",
    `Root: ${result.root}`,
    `Goal: ${result.init.goal.id} ${result.init.goal.title}`,
    "",
    formatStartupRepoOnboarding(result.repo),
    "",
    `Context: ${formatGeneratedStep(result.context)}`,
    `Measurement: ${formatGeneratedStep(result.measurement)}`,
    "",
    "Onboarding files:",
    listItems(result.onboardingFiles),
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupBuildMvp(result: StartupBuildMvpResult): string {
  return [
    "Startup build MVP",
    `Worker: ${result.worker}`,
    `Task: ${result.localAgentTaskId}`,
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    `Max turns: ${result.maxTurns}`,
    `Dependency policy: ${formatStartupDependencyApprovalBoundary(result.dependencyApproval)}`,
    `Attempts: ${result.attempts.length}`,
    `Verifier run: ${formatStartupMvpVerifierRun(result.verifierRun)}`,
    `MVP gate: ${result.gate.passed ? "passed" : "blocked"}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupWorkerGovernanceNotice(
  worker: LocalAgentWorkerKind,
  profile: ResolvedStartupWorkerGovernanceProfile =
    worker === "codex_direct" ? "governed" : "readiness"
): string {
  if (worker === "codex_direct") {
    return `Worker governance: ${profile} profile; codex_direct uses Runstead's Level 2 native tool proxy path; model tool calls are governed inside Runstead.`;
  }

  return `Worker governance: ${profile} profile; ${worker} uses Runstead's Level 1 process wrapper path; worker launch, sandbox, checkpoints, diff scope, and post-run verifiers are governed, but worker-internal tool calls are not hard-proxied. Use --governance governed or --worker codex_direct when every model tool call must pass through Runstead policy and audit.`;
}

export type StartupWorkerGovernanceProfile = "auto" | "readiness" | "governed";
export type ResolvedStartupWorkerGovernanceProfile = Exclude<
  StartupWorkerGovernanceProfile,
  "auto"
>;

export interface ResolvedStartupWorkerGovernance {
  profile: ResolvedStartupWorkerGovernanceProfile;
  worker: LocalAgentWorkerKind;
}

export function resolveStartupWorkerGovernance(input: {
  worker?: LocalAgentWorkerKind;
  target?: "local" | "staging" | "production";
  governanceProfile?: StartupWorkerGovernanceProfile;
}): ResolvedStartupWorkerGovernance {
  const profile = resolveStartupWorkerGovernanceProfile(input);
  const worker =
    input.worker ?? (profile === "governed" ? "codex_direct" : "codex_cli");

  if (profile === "governed" && worker !== "codex_direct") {
    throw new Error(
      `Governance profile governed requires --worker codex_direct; ${worker} is a Level 1 readiness wrapper without hard-proxied worker-internal tool calls`
    );
  }

  return {
    profile,
    worker
  };
}

function resolveStartupWorkerGovernanceProfile(input: {
  worker?: LocalAgentWorkerKind;
  target?: "local" | "staging" | "production";
  governanceProfile?: StartupWorkerGovernanceProfile;
}): ResolvedStartupWorkerGovernanceProfile {
  if (
    input.governanceProfile !== undefined &&
    input.governanceProfile !== "auto"
  ) {
    return input.governanceProfile;
  }

  if (input.worker === "codex_direct") {
    return "governed";
  }

  return input.target === "production" ? "governed" : "readiness";
}

export function resolveStartupDependencyApprovalBoundary(input: {
  policy?: string;
  allowedDependencies?: string[];
}): StartupDependencyApprovalBoundary {
  const policy = parseStartupDependencyApprovalPolicy(
    input.policy ?? "approval-required"
  );
  const allowedDependencies = dedupeNonEmpty(input.allowedDependencies ?? []);

  if (policy === "allow-listed" && allowedDependencies.length === 0) {
    throw new Error(
      "--dependency-policy allow-listed requires at least one --allow-dependency value"
    );
  }

  if (policy === "approval-required") {
    return {
      policy,
      allowedDependencies,
      approvalRequired: [
        "dependency additions or upgrades",
        "package manager changes",
        "external writes"
      ],
      workerInstruction:
        "Dependency approval policy: approval-required. Do not install, add, remove, or upgrade dependencies unless the founder explicitly grants approval in this run. If a dependency would improve the MVP, return needs_approval=true with the package name, dependency class, and reason."
    };
  }

  if (policy === "allow-listed") {
    return {
      policy,
      allowedDependencies,
      approvalRequired: [
        "dependencies outside allowed list",
        "package manager changes outside allowed list",
        "external writes"
      ],
      workerInstruction: [
        "Dependency approval policy: allow-listed.",
        `Allowed dependency additions: ${allowedDependencies.join(", ")}.`,
        "Do not install, add, remove, or upgrade any dependency outside this list unless approval is granted. If another dependency is needed, return needs_approval=true with the package name, dependency class, and reason."
      ].join(" ")
    };
  }

  return {
    policy,
    allowedDependencies: [],
    approvalRequired: ["all dependency additions or upgrades", "external writes"],
    workerInstruction:
      "Dependency approval policy: deny-new. Do not install, add, remove, or upgrade dependencies in this run. If the MVP cannot be completed without a dependency change, return needs_approval=true with the package name, dependency class, and reason."
  };
}

export function formatStartupDependencyApprovalBoundary(
  boundary: StartupDependencyApprovalBoundary
): string {
  return [
    boundary.policy,
    `allowed=${boundary.allowedDependencies.length === 0 ? "none" : boundary.allowedDependencies.join(",")}`,
    `approval_required=${boundary.approvalRequired.join(", ")}`
  ].join("; ");
}

function parseStartupDependencyApprovalPolicy(
  value: string
): StartupDependencyApprovalPolicy {
  if (
    value === "approval-required" ||
    value === "allow-listed" ||
    value === "deny-new"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported dependency policy ${value}. Expected approval-required, allow-listed, or deny-new.`
  );
}

async function startupBuildMvpPromptWithDependencyBoundary(input: {
  cwd: string;
  prompt?: string;
  dependencyApproval: StartupDependencyApprovalBoundary;
}): Promise<string> {
  return [
    input.prompt ?? (await defaultBuildMvpPrompt(input.cwd)),
    "",
    "Dependency approval boundary:",
    input.dependencyApproval.workerInstruction
  ].join("\n");
}

function verifierRunFromLocalAgentRun(
  run: RunLocalAgentTaskResult
): StartupMvpVerifierRun {
  if (run.verifierResults === undefined) {
    return {
      status: "skipped",
      reason: `worker finished with status ${run.status}`
    };
  }

  const hasFailure = run.verifierResults.some(
    (result) => result.exitCode !== 0 || result.timedOut
  );

  return {
    status: hasFailure ? "failed" : "completed",
    taskId: run.task.id,
    commandResults: run.verifierResults
  };
}

function startupMvpVerifierRunPassed(run: StartupMvpVerifierRun): boolean {
  return (
    run.status === "completed" &&
    run.commandResults.every(
      (result) => result.exitCode === 0 && result.timedOut === false
    )
  );
}

function startupBuildMvpRetryPrompt(input: {
  basePrompt: string;
  attempt: number;
  maxAttempts: number;
  verifierRun: StartupMvpVerifierRun;
}): string {
  return [
    input.basePrompt,
    "",
    `Previous MVP build attempt ${input.attempt}/${input.maxAttempts} did not satisfy the verifier contract.`,
    "Use the verifier evidence below as the repair target. Do not broaden scope.",
    "",
    "Verifier evidence:",
    ...startupMvpVerifierEvidenceLines(input.verifierRun)
  ].join("\n");
}

function startupMvpVerifierEvidenceLines(run: StartupMvpVerifierRun): string[] {
  if (run.status === "skipped") {
    return [`- skipped: ${run.reason}`];
  }

  return run.commandResults.map((result) =>
    [
      `- ${result.verifier}:`,
      `exit=${result.exitCode ?? "null"}`,
      `timed_out=${result.timedOut}`,
      `evidence=${result.evidenceId}`
    ].join(" ")
  );
}

function normalizeStartupBuildMvpMaxAttempts(value: number | undefined): number {
  if (value === undefined) {
    return 2;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Startup MVP maxAttempts must be an integer between 1 and 5");
  }

  return value;
}

function normalizeStartupBuildMvpMaxTurns(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_STARTUP_BUILD_MVP_MAX_TURNS;
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Startup MVP maxTurns must be an integer between 1 and 100");
  }

  return value;
}

function formatStartupMvpVerifierRun(run: StartupMvpVerifierRun): string {
  if (run.status === "skipped") {
    return `skipped (${run.reason})`;
  }

  const passed = run.commandResults.filter(
    (result) => result.exitCode === 0 && result.timedOut === false
  ).length;

  return `${run.status} (${passed}/${run.commandResults.length} commands passed, task=${run.taskId})`;
}

export function formatStartupLaunchCheck(result: StartupLaunchCheckResult): string {
  return [
    "Startup launch check",
    `Status: ${result.status}`,
    `Report: ${result.reportPath}`,
    `Gate: ${result.gate.passed ? "passed" : "blocked"}`,
    `Blockers: ${result.blockers.length}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

export function formatStartupScaleCheck(result: StartupScaleCheckResult): string {
  return [
    "Startup scale check",
    `Ops report: ${result.opsReport.files[0] ?? "none"}`,
    `Gate: ${result.gate.passed ? "passed" : "blocked"}`,
    `Blockers: ${result.gate.blockers.length}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
}

async function generatedStep<T>(
  action: () => Promise<T>
): Promise<StartupGeneratedStep<T>> {
  try {
    return {
      status: "generated",
      result: await action()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("already exists")) {
      return {
        status: "skipped",
        reason: message
      };
    }

    throw error;
  }
}

async function defaultBuildMvpPrompt(cwd: string): Promise<string> {
  const inspection = await collectRepoInspection(cwd, new Date().toISOString());

  return [
    "Build or repair the AI-coded MVP for this repository.",
    "Use the existing framework and keep the implementation scoped to the product surface.",
    "Make the verifier commands pass and record launch-relevant evidence when appropriate.",
    "",
    "Detected verifier contract:",
    ...verifierContractLines(inspection)
  ].join("\n");
}

async function verifierCommands(cwd: string, now?: Date) {
  const inspection = await collectRepoInspection(
    cwd,
    (now ?? new Date()).toISOString()
  );
  const packageManager = inspection.packageManager.packageManager ?? "npm";

  return [
    commandVerifier("test", inspection.commands.test.command, `${packageManager} test`),
    commandVerifier(
      "lint",
      inspection.commands.lint.command,
      `${packageManager} run lint`
    ),
    commandVerifier(
      "typecheck",
      inspection.commands.typecheck.command,
      `${packageManager} run typecheck`
    ),
    commandVerifier(
      "build",
      inspection.commands.build.command,
      `${packageManager} run build`
    )
  ];
}

function commandVerifier(
  name: string,
  command: string | undefined,
  fallbackCommand: string
): { name: string; command: string } {
  return {
    name,
    command: command ?? fallbackCommand
  };
}

function verifierContractLines(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    `- test: ${inspection.commands.test.command ?? "missing"}`,
    `- lint: ${inspection.commands.lint.command ?? "missing"}`,
    `- typecheck: ${inspection.commands.typecheck.command ?? "missing"}`,
    `- build: ${inspection.commands.build.command ?? "missing"}`
  ];
}

function formatGeneratedStep<T>(step: StartupGeneratedStep<T>): string {
  return step.status === "generated" ? "generated" : `skipped (${step.reason})`;
}

function listItems(items: string[]): string {
  return items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");
}

function dedupeNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function writeStartupOnboardingFiles(input: {
  root: string;
  repo: StartupRepoOnboardingResult;
  nextCommands: string[];
  generatedAt: string;
}): Promise<string[]> {
  const startupDir = join(input.root, "startup");
  const quickstartPath = join(startupDir, "quickstart.md");
  const upgradePath = join(startupDir, "upgrade-guide.md");

  await mkdir(startupDir, { recursive: true });
  await Promise.all([
    writeFile(quickstartPath, formatStartupQuickstart(input), "utf8"),
    writeFile(upgradePath, formatStartupUpgradeGuide(input), "utf8")
  ]);

  return [quickstartPath, upgradePath];
}

function formatStartupQuickstart(input: {
  repo: StartupRepoOnboardingResult;
  nextCommands: string[];
  generatedAt: string;
}): string {
  return [
    "# Runstead Startup Quickstart",
    "",
    `Generated: ${input.generatedAt}`,
    `Workspace: ${input.repo.workspace}`,
    `Suggested template: ${input.repo.suggestedTemplate}`,
    `Package manager: ${input.repo.packageManager} (${input.repo.packageManagerSource})`,
    "",
    "## Verifier Contract",
    "",
    listItems(
      input.repo.verifierContract.map(
        (verifier) =>
          `${verifier.name}: ${verifier.command}${verifier.detected ? " (detected)" : " (suggested)"}`
      )
    ),
    "",
    "## First Run",
    "",
    listItems(input.nextCommands),
    "",
    "## Review Surfaces",
    "",
    listItems([
      "Markdown reports live in .runstead/reports/.",
      "Startup artifacts live in .runstead/startup/.",
      "Run runstead startup status after each build or launch check."
    ]),
    ""
  ].join("\n");
}

function formatStartupUpgradeGuide(input: {
  repo: StartupRepoOnboardingResult;
  generatedAt: string;
}): string {
  return [
    "# Runstead Startup Upgrade Guide",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Before Upgrade",
    "",
    listItems([
      "Commit or stash product changes before upgrading Runstead state.",
      "Run runstead doctor --cwd . and resolve failed checks.",
      "Keep .runstead/ ignored unless the team intentionally tracks generated state."
    ]),
    "",
    "## Upgrade Commands",
    "",
    listItems([
      "runstead upgrade --cwd .",
      "runstead domain upgrade ai-native-startup --cwd . --force",
      "runstead startup launch-check --cwd ."
    ]),
    "",
    "## Compatibility Notes",
    "",
    listItems([
      `Detected package manager: ${input.repo.packageManager} (${input.repo.packageManagerSource}).`,
      "Runstead CLI expects Node >=24.15 <27.",
      "Domain pack upgrades record migration steps in the audit log."
    ]),
    ""
  ].join("\n");
}
