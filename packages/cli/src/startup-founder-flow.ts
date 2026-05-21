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
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface StartupFounderFlowOptions {
  cwd?: string;
  profile?: InitPolicyProfile;
  force?: boolean;
  writeCi?: boolean;
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
  gate: StartupGateCheckResult;
  nextCommands: string[];
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
      ...(options.now === undefined ? {} : { now: options.now })
    })
  );
  const measurement = await generatedStep(() =>
    generateMeasurementFramework({
      cwd,
      force: options.force === true,
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
  const init = await initStartup({
    cwd,
    stage: "mvp",
    profile: options.profile ?? "trusted-local",
    force: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const created = await createLocalAgentTask({
    cwd,
    title: "Build startup MVP",
    prompt: options.prompt ?? (await defaultBuildMvpPrompt(cwd)),
    worker,
    mode: "repair",
    checkpoint: true,
    verifierCommands: await verifierCommands(cwd, options.now),
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
  const gate = await checkStartupGate({
    cwd,
    stage: "mvp",
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: init.root,
    worker,
    localAgentTaskId: created.task.id,
    status: run.status,
    summary: run.summary,
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
    `MVP gate: ${result.gate.passed ? "passed" : "blocked"}`,
    "",
    "Next commands:",
    listItems(result.nextCommands)
  ].join("\n");
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

  return [
    commandVerifier("test", inspection.commands.test.command),
    commandVerifier("lint", inspection.commands.lint.command),
    commandVerifier("typecheck", inspection.commands.typecheck.command),
    commandVerifier("build", inspection.commands.build.command)
  ].filter((item): item is { name: string; command: string } => item !== undefined);
}

function commandVerifier(
  name: string,
  command: string | undefined
): { name: string; command: string } | undefined {
  return command === undefined ? undefined : { name, command };
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
