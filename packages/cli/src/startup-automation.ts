import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Goal, Task } from "@runstead/core";

import { installDomainPack, upgradeDomainPack } from "./domain-pack-install.js";
import { createGoal, listGoals } from "./goals.js";
import { initRunstead, type InitPolicyProfile } from "./init.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import { resolveRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence } from "./startup-evidence.js";

export type StartupInitStage = "mvp" | "launch" | "scale";

export interface StartupInitOptions {
  cwd?: string;
  stage?: StartupInitStage;
  profile?: InitPolicyProfile;
  force?: boolean;
  now?: Date;
}

export interface StartupInitResult {
  root: string;
  stateDb: string;
  stage: StartupInitStage;
  domainInstalled: boolean;
  domainUpgraded: boolean;
  goalCreated: boolean;
  goal: Goal;
  generatedTasks: Task[];
}

export interface GenerateStartupContextOptions {
  cwd?: string;
  force?: boolean;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  now?: Date;
}

export interface GenerateStartupContextResult {
  root: string;
  stateDb: string;
  files: string[];
  evidenceId: string;
}

export interface GenerateMeasurementFrameworkOptions {
  cwd?: string;
  force?: boolean;
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
  now?: Date;
}

export interface GenerateMeasurementFrameworkResult {
  root: string;
  stateDb: string;
  files: string[];
  evidenceId: string;
}

const STARTUP_DOMAIN = "ai-native-startup";
const STARTUP_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];

export async function initStartup(
  options: StartupInitOptions = {}
): Promise<StartupInitResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? "mvp";
  const initialized = await ensureRunsteadInitialized({
    cwd,
    profile: options.profile ?? "default",
    force: options.force === true
  });
  const domainPath = join(initialized.root, "domains", STARTUP_DOMAIN, "domain.yaml");
  const hadDomain = await exists(domainPath);
  let domainUpgraded = false;

  if (!hadDomain) {
    await installDomainPack({
      cwd,
      ref: STARTUP_DOMAIN,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } else if (options.force === true) {
    await upgradeDomainPack({
      cwd,
      ref: STARTUP_DOMAIN,
      force: true,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    domainUpgraded = true;
  }

  const template = templateForStage(stage);
  const existingGoal = findActiveStartupGoal(cwd, template);

  if (existingGoal !== undefined && options.force !== true) {
    return {
      root: initialized.root,
      stateDb: initialized.stateDb,
      stage,
      domainInstalled: !hadDomain,
      domainUpgraded,
      goalCreated: false,
      goal: existingGoal,
      generatedTasks: []
    };
  }

  const created = await createGoal({
    cwd,
    domain: STARTUP_DOMAIN,
    template,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: initialized.root,
    stateDb: initialized.stateDb,
    stage,
    domainInstalled: !hadDomain,
    domainUpgraded,
    goalCreated: true,
    goal: created.goal,
    generatedTasks: created.generatedTasks
  };
}

export async function generateStartupContext(
  options: GenerateStartupContextOptions = {}
): Promise<GenerateStartupContextResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const inspection = await collectRepoInspection(cwd, generatedAt);
  const context = formatStartupAgentContext({
    generatedAt,
    inspection,
    ...(options.architecturePrinciples === undefined
      ? {}
      : { architecturePrinciples: options.architecturePrinciples }),
    ...(options.technicalConstraints === undefined
      ? {}
      : { technicalConstraints: options.technicalConstraints }),
    ...(options.acceptedDebt === undefined
      ? {}
      : { acceptedDebt: options.acceptedDebt })
  });
  const files: string[] = [];

  for (const filename of STARTUP_CONTEXT_FILES) {
    const path = join(cwd, filename);

    if (options.force !== true && (await exists(path))) {
      throw new Error(`${filename} already exists. Use --force to overwrite it.`);
    }

    await writeFile(path, contextForFile(filename, context), "utf8");
    files.push(path);
  }

  await mkdir(join(state.root, "startup"), { recursive: true });
  const summaryPath = join(state.root, "startup", "agent-context.md");

  await writeFile(summaryPath, context, "utf8");

  const evidence = await addStartupEvidence({
    cwd,
    type: "agent_context",
    summary: "Generated startup agent context files",
    sourceRefs: [...files, summaryPath],
    content: context,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files,
    evidenceId: evidence.evidence.id
  };
}

export async function generateMeasurementFramework(
  options: GenerateMeasurementFrameworkOptions = {}
): Promise<GenerateMeasurementFrameworkResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const framework = formatMeasurementFramework({
    generatedAt,
    ...(options.activationMetric === undefined
      ? {}
      : { activationMetric: options.activationMetric }),
    ...(options.retentionMetric === undefined
      ? {}
      : { retentionMetric: options.retentionMetric }),
    ...(options.day7Metric === undefined ? {} : { day7Metric: options.day7Metric }),
    ...(options.day30Metric === undefined ? {} : { day30Metric: options.day30Metric }),
    ...(options.falsePositiveMetric === undefined
      ? {}
      : { falsePositiveMetric: options.falsePositiveMetric })
  });
  const rootPath = join(cwd, "MEASUREMENT.md");

  if (options.force !== true && (await exists(rootPath))) {
    throw new Error("MEASUREMENT.md already exists. Use --force to overwrite it.");
  }

  await writeFile(rootPath, framework, "utf8");
  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "measurement-framework.md");

  await writeFile(runtimePath, framework, "utf8");

  const evidence = await addStartupEvidence({
    cwd,
    type: "measurement_framework",
    summary: "Generated startup measurement framework",
    sourceRefs: [rootPath, runtimePath],
    content: framework,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [rootPath, runtimePath],
    evidenceId: evidence.evidence.id
  };
}

function templateForStage(stage: StartupInitStage): string {
  switch (stage) {
    case "mvp":
    case "launch":
      return "build-mvp";
    case "scale":
      return "scale-ops";
  }
}

async function ensureRunsteadInitialized(input: {
  cwd: string;
  profile: InitPolicyProfile;
  force: boolean;
}): Promise<{ root: string; stateDb: string }> {
  const resolved = await resolveRunsteadRoot(input.cwd);

  if (resolved.source === "missing") {
    const initialized = await initRunstead({
      cwd: input.cwd,
      profile: input.profile,
      force: input.force
    });

    return {
      root: initialized.root,
      stateDb: initialized.stateDb
    };
  }

  const state = await requireRunsteadStateDb(input.cwd);

  return {
    root: state.root,
    stateDb: state.stateDb
  };
}

function findActiveStartupGoal(cwd: string, template: string): Goal | undefined {
  return listGoals({ cwd }).goals.find(
    (goal) =>
      goal.domain === STARTUP_DOMAIN &&
      goal.status === "active" &&
      goal.scope.templateId === template
  );
}

function formatStartupAgentContext(input: {
  generatedAt: string;
  architecturePrinciples?: string[];
  technicalConstraints?: string[];
  acceptedDebt?: string[];
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>;
}): string {
  const testCommand = input.inspection.commands.test.detected
    ? input.inspection.commands.test.command
    : "missing";
  const lintCommand = input.inspection.commands.lint.detected
    ? input.inspection.commands.lint.command
    : "missing";
  const ci = input.inspection.ci.detected
    ? input.inspection.ci.providers.map((provider) => provider.provider).join(", ")
    : "missing";
  const packageManager = input.inspection.packageManager.detected
    ? `${input.inspection.packageManager.packageManager} (${input.inspection.packageManager.source})`
    : "missing";

  return [
    "# Startup Agent Context",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Execution Contract",
    "",
    "- Runstead is the control plane for goals, policy, evidence, verifiers, audit, and resume.",
    "- Worker agents execute inside the scope and verifier expectations recorded here.",
    "- Do not claim launch readiness without verifier evidence and measurement framework evidence.",
    "",
    "## Repository Facts",
    "",
    `- Git repo: ${input.inspection.git.isGitRepo ? "yes" : "no"}`,
    `- Branch: ${input.inspection.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${testCommand}`,
    `- Lint command: ${lintCommand}`,
    `- CI: ${ci}`,
    "",
    "## Architecture Principles",
    "",
    listItems(
      input.architecturePrinciples ?? [
        "Prefer repo-local patterns and existing framework conventions.",
        "Keep startup execution artifacts evidence-backed and auditable.",
        "Preserve repo-maintenance as the first product path while extending startup readiness."
      ]
    ),
    "",
    "## Technical Constraints",
    "",
    listItems(
      input.technicalConstraints ?? [
        "Protected paths and secrets must not be edited without explicit approval.",
        "External writes, publishing, and dependency changes require approval.",
        "Verifier commands must be recorded as evidence before release decisions."
      ]
    ),
    "",
    "## Accepted Technical Debt",
    "",
    listItems(
      input.acceptedDebt ?? ["No accepted startup technical debt recorded yet."]
    ),
    "",
    "## Verifier Commands",
    "",
    listItems([`test: ${testCommand}`, `lint: ${lintCommand}`]),
    "",
    "## Startup Stage Gates",
    "",
    "- MVP: agent context, measurement framework, repo readiness, and verifier evidence.",
    "- Launch: release blockers resolved, observability present, and launch readiness report generated.",
    "- Scale: founder bottlenecks, workflow registry, SOPs, support triage, and GTM evidence verified.",
    ""
  ].join("\n");
}

function contextForFile(filename: string, baseContext: string): string {
  return [`# ${filename}`, "", baseContext].join("\n");
}

function formatMeasurementFramework(input: {
  generatedAt: string;
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
}): string {
  const activation =
    input.activationMetric ?? "User completes the first successful core workflow.";
  const retention =
    input.retentionMetric ?? "User returns and completes a core workflow again.";
  const day7 = input.day7Metric ?? "Day 7 retained active users by signup cohort.";
  const day30 = input.day30Metric ?? "Day 30 retained active users by signup cohort.";
  const falsePositive =
    input.falsePositiveMetric ??
    "Runstead or product claim is counted as success without user-confirmed value.";

  return [
    "# Startup Measurement Framework",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Launch Rule",
    "",
    "Runstead must not mark the MVP launch-ready without this measurement framework and current verifier evidence.",
    "",
    "## Metrics",
    "",
    `- Activation: ${activation}`,
    `- Retention: ${retention}`,
    `- Day 7: ${day7}`,
    `- Day 30: ${day30}`,
    `- False-positive metric: ${falsePositive}`,
    "",
    "## Evidence Requirements",
    "",
    "- Attach customer, product, or analytics evidence before treating a metric as validated.",
    "- Link metric evidence to the startup goal or decision it supports.",
    "- Re-run the launch gate after metrics or verifier evidence changes.",
    ""
  ].join("\n");
}

function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
