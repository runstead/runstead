import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { Goal, Task } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { installDomainPack, upgradeDomainPack } from "./domain-pack-install.js";
import { createGoal, listGoals } from "./goals.js";
import { initRunstead, type InitPolicyProfile } from "./init.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import {
  recordProjectFact,
  retrieveProjectFacts,
  type RetrieveProjectFactsResult
} from "./memory.js";
import { matchesPolicyPathPattern } from "./policy.js";
import { resolveRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import {
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
  listStartupArtifacts,
  type StartupArtifactListItem
} from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";

const execFileAsync = promisify(execFile);

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
  structuredFiles: string[];
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
  structuredFiles: string[];
  evidenceId: string;
}

export interface GenerateRepoReadinessAuditOptions {
  cwd?: string;
  now?: Date;
}

export interface GenerateRepoReadinessAuditResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  blockers: string[];
  warnings: string[];
}

export interface GenerateSecurityBaselineOptions {
  cwd?: string;
  now?: Date;
}

export interface GenerateSecurityBaselineResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  blockers: string[];
  warnings: string[];
}

export interface RecordSupportTriageOptions {
  cwd?: string;
  request: string;
  outcome: string;
  customer?: string;
  severity?: string;
  category?: string;
  sourceRefs?: string[];
  now?: Date;
}

export interface RecordSupportTriageResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
}

export interface GenerateFounderBottleneckMapOptions {
  cwd?: string;
  bottlenecks?: string[];
  owner?: string;
  systemOfRecord?: string;
  handoffDueDate?: string;
  status?: string;
  now?: Date;
}

export interface GenerateFounderBottleneckMapResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  bottlenecks: string[];
}

export interface GenerateWorkflowRegistryOptions {
  cwd?: string;
  workflows?: string[];
  delegationRules?: string[];
  approvalBoundaries?: string[];
  allowedAgents?: string[];
  constrainedTaskTypes?: string[];
  now?: Date;
}

export interface GenerateWorkflowRegistryResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceIds: string[];
  workflows: string[];
  delegationRules: string[];
}

export interface CaptureInstitutionalMemoryOptions {
  cwd?: string;
  knowledge?: string[];
  scope?: string;
  sourceRefs?: string[];
  now?: Date;
}

export interface CaptureInstitutionalMemoryResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  memoryId: string;
  knowledge: string[];
}

export interface RetrieveStartupInstitutionalMemoryOptions {
  cwd?: string;
  scope?: string;
  query?: string;
  limit?: number;
  now?: Date;
}

export interface GenerateIntegrationMapOptions {
  cwd?: string;
  integrations?: string[];
  lockInSignals?: string[];
  automationCoverage?: string[];
  adoptionSignals?: string[];
  workflowSignals?: string[];
  now?: Date;
}

export interface GenerateIntegrationMapResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  integrations: string[];
}

export interface GenerateScaleOpsReportOptions {
  cwd?: string;
  period?: string;
  now?: Date;
}

export interface GenerateScaleOpsReportResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  period: string;
}

export interface ScheduleScaleReportOptions {
  cwd?: string;
  cadence?: string;
  owner?: string;
  nextRunAt?: string;
  periodTemplate?: string;
  now?: Date;
}

export interface ScheduleScaleReportResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  nextCommand: string;
}

export interface GenerateOpsSopsOptions {
  cwd?: string;
  sops?: string[];
  owner?: string;
  workflow?: string;
  now?: Date;
}

export interface GenerateOpsSopsResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  sops: string[];
}

export interface VerifyGtmArtifactsOptions {
  cwd?: string;
  claims?: string[];
  evidenceRefs?: string[];
  productState?: string;
  now?: Date;
}

export interface VerifyGtmArtifactsResult {
  root: string;
  stateDb: string;
  files: string[];
  structuredFiles: string[];
  evidenceId: string;
  claims: string[];
}

interface StartupStructuredArtifact {
  schemaVersion: typeof STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION;
  schema: typeof STARTUP_STRUCTURED_ARTIFACT_SCHEMA;
  kind: string;
  generatedAt: string;
  markdownPath: string;
  data: Record<string, unknown>;
}

interface StartupEvidenceSummaryRow {
  id: string;
  type: string;
  summary: string | null;
  created_at: string;
}

const STARTUP_DOMAIN = "ai-native-startup";
const STARTUP_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "CODEX.md"];
const PROTECTED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/secrets/**",
  "infra/prod/**",
  "billing/**",
  "compliance/**"
];
const DEPENDENCY_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb"
];

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
  const structuredFiles: string[] = [];
  const contextData = {
    contextFiles: STARTUP_CONTEXT_FILES,
    inspection,
    architecturePrinciples: options.architecturePrinciples ?? [],
    technicalConstraints: options.technicalConstraints ?? [],
    acceptedDebt: options.acceptedDebt ?? []
  };

  for (const filename of STARTUP_CONTEXT_FILES) {
    const path = join(cwd, filename);

    if (options.force !== true && (await exists(path))) {
      throw new Error(`${filename} already exists. Use --force to overwrite it.`);
    }

    await writeFile(path, contextForFile(filename, context), "utf8");
    files.push(path);
    structuredFiles.push(
      await writeStartupStructuredArtifact({
        kind: "startup_agent_context",
        generatedAt,
        markdownPath: path,
        data: {
          ...contextData,
          contextFile: filename
        }
      })
    );
  }

  await mkdir(join(state.root, "startup"), { recursive: true });
  const summaryPath = join(state.root, "startup", "agent-context.md");

  await writeFile(summaryPath, context, "utf8");
  structuredFiles.push(
    await writeStartupStructuredArtifact({
      kind: "startup_agent_context",
      generatedAt,
      markdownPath: summaryPath,
      data: {
        ...contextData,
        contextFile: "agent-context.md"
      }
    })
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "agent_context",
    summary: "Generated startup agent context files",
    sourceRefs: [...files, summaryPath, ...structuredFiles],
    content: context,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files,
    structuredFiles,
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
  const measurementData = {
    activationMetric:
      options.activationMetric ?? "User completes the first successful core workflow.",
    retentionMetric:
      options.retentionMetric ?? "User returns and completes a core workflow again.",
    day7Metric: options.day7Metric ?? "Day 7 retained active users by signup cohort.",
    day30Metric:
      options.day30Metric ?? "Day 30 retained active users by signup cohort.",
    falsePositiveMetric:
      options.falsePositiveMetric ??
      "Runstead or product claim is counted as success without user-confirmed value.",
    metrics: measurementMetricDefinitions({
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
        : { falsePositiveMetric: options.falsePositiveMetric })
    })
  };

  await writeFile(runtimePath, framework, "utf8");
  const structuredFiles = await Promise.all(
    [rootPath, runtimePath].map((path) =>
      writeStartupStructuredArtifact({
        kind: "startup_measurement_framework",
        generatedAt,
        markdownPath: path,
        data: measurementData
      })
    )
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "measurement_framework",
    summary: "Generated startup measurement framework",
    sourceRefs: [rootPath, runtimePath, ...structuredFiles],
    content: framework,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [rootPath, runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id
  };
}

export async function generateRepoReadinessAudit(
  options: GenerateRepoReadinessAuditOptions = {}
): Promise<GenerateRepoReadinessAuditResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const inspection = await collectRepoInspection(cwd, generatedAt);
  const changedProtected = await changedProtectedPaths(cwd);
  const blockers = repoReadinessBlockers(inspection, changedProtected);
  const warnings = repoReadinessWarnings(inspection);
  const markdown = formatRepoReadinessAudit({
    generatedAt,
    inspection,
    changedProtected,
    blockers,
    warnings
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "repo-readiness.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_repo_readiness",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        inspection,
        changedProtected,
        blockers,
        warnings
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "repo_readiness",
    summary: `Repository readiness audit recorded (${blockers.length} blocker${blockers.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    blockers,
    warnings
  };
}

export async function generateSecurityBaseline(
  options: GenerateSecurityBaselineOptions = {}
): Promise<GenerateSecurityBaselineResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const changedProtected = await changedProtectedPaths(cwd);
  const envFiles = await findTopLevelEnvFiles(cwd);
  const dependencyFiles = await existingDependencyFiles(cwd);
  const blockers = securityBaselineBlockers(changedProtected);
  const warnings = securityBaselineWarnings({ envFiles, dependencyFiles });
  const markdown = formatSecurityBaseline({
    generatedAt,
    changedProtected,
    envFiles,
    dependencyFiles,
    blockers,
    warnings
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "security-baseline.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_security_baseline",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        changedProtected,
        envFiles,
        dependencyFiles,
        blockers,
        warnings
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "security_baseline",
    summary: `Security baseline recorded (${blockers.length} blocker${blockers.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    blockers,
    warnings
  };
}

export async function recordSupportTriage(
  options: RecordSupportTriageOptions
): Promise<RecordSupportTriageResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const markdown = formatSupportTriage({
    generatedAt,
    request: options.request,
    outcome: options.outcome,
    ...(options.customer === undefined ? {} : { customer: options.customer }),
    severity: options.severity ?? "medium",
    category: options.category ?? "uncategorized",
    sourceRefs: options.sourceRefs ?? []
  });

  await mkdir(join(state.root, "startup", "support-triage"), { recursive: true });

  const runtimePath = join(
    state.root,
    "startup",
    "support-triage",
    `${safeTimestamp(generatedAt)}.md`
  );

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_support_triage",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        request: options.request,
        outcome: options.outcome,
        customer: options.customer ?? null,
        severity: options.severity ?? "medium",
        category: options.category ?? "uncategorized",
        sourceRefs: options.sourceRefs ?? []
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "support_triage",
    summary: `Support triage recorded (${options.category ?? "uncategorized"}): ${options.outcome}`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.sourceRefs ?? [])],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id
  };
}

export async function generateFounderBottleneckMap(
  options: GenerateFounderBottleneckMapOptions = {}
): Promise<GenerateFounderBottleneckMapResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const bottlenecks =
    options.bottlenecks === undefined || options.bottlenecks.length === 0
      ? ["No founder-only bottleneck input recorded; complete the audit before scale."]
      : options.bottlenecks;
  const markdown = formatFounderBottleneckMap({
    generatedAt,
    bottlenecks,
    owner: options.owner ?? "unassigned",
    systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
    status: options.status ?? "handoff-in-progress",
    ...(options.handoffDueDate === undefined
      ? {}
      : { handoffDueDate: options.handoffDueDate })
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "founder-bottlenecks.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_founder_bottleneck",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        bottlenecks,
        owner: options.owner ?? "unassigned",
        systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
        status: options.status ?? "handoff-in-progress",
        handoffDueDate: options.handoffDueDate ?? null
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "founder_bottleneck",
    summary: `Founder bottleneck map recorded (${bottlenecks.length} item${bottlenecks.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        bottlenecks,
        owner: options.owner ?? "unassigned",
        systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
        status: options.status ?? "handoff-in-progress",
        handoffDueDate: options.handoffDueDate ?? null
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    bottlenecks
  };
}

export async function generateWorkflowRegistry(
  options: GenerateWorkflowRegistryOptions = {}
): Promise<GenerateWorkflowRegistryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const workflows =
    options.workflows === undefined || options.workflows.length === 0
      ? [
          "No recurring workflow input recorded; inventory recurring ops before delegation."
        ]
      : options.workflows;
  const delegationRules =
    options.delegationRules === undefined || options.delegationRules.length === 0
      ? [
          "Read-only inspection and report drafting may run without approval.",
          "External writes, publishing, billing, compliance, and production changes require approval."
        ]
      : options.delegationRules;
  const approvalBoundaries =
    options.approvalBoundaries === undefined || options.approvalBoundaries.length === 0
      ? ["publish", "external_write", "protected_path", "dependency_change"]
      : options.approvalBoundaries;
  const allowedAgents =
    options.allowedAgents === undefined || options.allowedAgents.length === 0
      ? ["codex_cli", "claude_code"]
      : options.allowedAgents;
  const constrainedTaskTypes =
    options.constrainedTaskTypes === undefined ||
    options.constrainedTaskTypes.length === 0
      ? ["startup_remediation", "run_mvp_verifiers", "startup_scale_report"]
      : options.constrainedTaskTypes;
  const workflowMarkdown = formatWorkflowRegistry({
    generatedAt,
    workflows,
    approvalBoundaries
  });
  const delegationMarkdown = formatDelegationPolicy({
    generatedAt,
    delegationRules,
    approvalBoundaries,
    allowedAgents,
    constrainedTaskTypes
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const workflowPath = join(state.root, "startup", "workflow-registry.md");
  const delegationPath = join(state.root, "startup", "delegation-policy.md");

  await writeFile(workflowPath, workflowMarkdown, "utf8");
  await writeFile(delegationPath, delegationMarkdown, "utf8");
  const workflowStructuredPath = await writeStartupStructuredArtifact({
    kind: "startup_workflow_registry",
    generatedAt,
    markdownPath: workflowPath,
    data: {
      workflows,
      approvalBoundaries,
      constrainedTaskTypes
    }
  });
  const delegationStructuredPath = await writeStartupStructuredArtifact({
    kind: "startup_delegation_policy",
    generatedAt,
    markdownPath: delegationPath,
    data: {
      delegationRules,
      approvalBoundaries,
      allowedAgents,
      constrainedTaskTypes
    }
  });
  const structuredFiles = [workflowStructuredPath, delegationStructuredPath];

  const workflowEvidence = await addStartupEvidence({
    cwd,
    type: "workflow_registry",
    summary: `Workflow registry recorded (${workflows.length} workflow${workflows.length === 1 ? "" : "s"})`,
    sourceRefs: [workflowPath, workflowStructuredPath, delegationPath],
    content: workflowMarkdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const delegationEvidence = await addStartupEvidence({
    cwd,
    type: "delegation_policy",
    summary: `Delegation policy recorded (${delegationRules.length} rule${delegationRules.length === 1 ? "" : "s"})`,
    sourceRefs: [delegationPath, delegationStructuredPath, workflowPath],
    content: JSON.stringify(
      {
        markdown: delegationMarkdown,
        delegationRules,
        approvalBoundaries,
        allowedAgents,
        constrainedTaskTypes
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [workflowPath, delegationPath],
    structuredFiles,
    evidenceIds: [workflowEvidence.evidence.id, delegationEvidence.evidence.id],
    workflows,
    delegationRules
  };
}

export async function captureInstitutionalMemory(
  options: CaptureInstitutionalMemoryOptions = {}
): Promise<CaptureInstitutionalMemoryResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const knowledge =
    options.knowledge === undefined || options.knowledge.length === 0
      ? [
          "No institutional memory input recorded; capture founder-only context before scale."
        ]
      : options.knowledge;
  const scope = options.scope ?? "startup/institutional-memory";
  const markdown = formatInstitutionalMemory({
    generatedAt,
    scope,
    knowledge,
    sourceRefs: options.sourceRefs ?? []
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "institutional-memory.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_institutional_memory",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        scope,
        knowledge,
        sourceRefs: options.sourceRefs ?? []
      }
    })
  ];

  const memory = recordProjectFact({
    cwd,
    scope,
    content: knowledge.join("\n"),
    sourceRefs: [
      pathToFileURL(runtimePath).href,
      ...structuredFiles.map((path) => pathToFileURL(path).href)
    ],
    createdBy: "startup scale memory capture",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const evidence = await addStartupEvidence({
    cwd,
    type: "institutional_memory",
    summary: `Institutional memory captured (${knowledge.length} item${knowledge.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.sourceRefs ?? [])],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    memoryId: memory.memory.id,
    knowledge
  };
}

export function retrieveStartupInstitutionalMemory(
  options: RetrieveStartupInstitutionalMemoryOptions = {}
): RetrieveProjectFactsResult {
  return retrieveProjectFacts({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    scope: options.scope ?? "startup/institutional-memory",
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

export async function generateIntegrationMap(
  options: GenerateIntegrationMapOptions = {}
): Promise<GenerateIntegrationMapResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const integrations =
    options.integrations === undefined || options.integrations.length === 0
      ? [
          "No integration input recorded; map customer workflow integrations before scale."
        ]
      : options.integrations;
  const markdown = formatIntegrationMap({
    generatedAt,
    integrations,
    lockInSignals: options.lockInSignals ?? [],
    automationCoverage: options.automationCoverage ?? [],
    adoptionSignals: options.adoptionSignals ?? [],
    workflowSignals: options.workflowSignals ?? []
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "integration-depth-map.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_integration_map",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        integrations,
        lockInSignals: options.lockInSignals ?? [],
        automationCoverage: options.automationCoverage ?? [],
        adoptionSignals: options.adoptionSignals ?? [],
        workflowSignals: options.workflowSignals ?? []
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "integration_map",
    summary: `Integration depth map recorded (${integrations.length} integration${integrations.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        integrations,
        lockInSignals: options.lockInSignals ?? [],
        automationCoverage: options.automationCoverage ?? [],
        adoptionSignals: options.adoptionSignals ?? [],
        workflowSignals: options.workflowSignals ?? []
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    integrations
  };
}

export async function generateScaleOpsReport(
  options: GenerateScaleOpsReportOptions = {}
): Promise<GenerateScaleOpsReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const period = options.period ?? generatedAt.slice(0, 10);
  const database = openRunsteadDatabase(state.stateDb);
  let evidence: StartupEvidenceSummaryRow[];

  try {
    evidence = readStartupEvidenceSummaries(database);
  } finally {
    database.close();
  }
  const startupArtifacts = (await listStartupArtifacts({ cwd })).artifacts;
  const supportCategoryCounts = supportCategoryCountsFromArtifacts(startupArtifacts);

  const markdown = formatScaleOpsReport({
    generatedAt,
    period,
    evidence,
    supportCategoryCounts
  });

  await mkdir(join(state.root, "reports"), { recursive: true });

  const runtimePath = join(state.root, "reports", `startup-ops-${period}.md`);

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_report",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        period,
        evidence,
        supportCategoryCounts
      }
    })
  ];

  const reportEvidence = await addStartupEvidence({
    cwd,
    type: "ops_report",
    summary: `Startup scale ops report generated for ${period}`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: reportEvidence.evidence.id,
    period
  };
}

export async function scheduleScaleReport(
  options: ScheduleScaleReportOptions = {}
): Promise<ScheduleScaleReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const cadence = options.cadence ?? "weekly";
  const owner = options.owner ?? "unassigned";
  const periodTemplate = options.periodTemplate ?? "YYYY-WW";
  const nextRunAt = options.nextRunAt ?? generatedAt.slice(0, 10);
  const nextCommand = `runstead startup scale report --period ${periodTemplate}`;
  const markdown = formatScaleReportSchedule({
    generatedAt,
    cadence,
    owner,
    nextRunAt,
    periodTemplate,
    nextCommand
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "scale-report-schedule.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_schedule",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        cadence,
        owner,
        nextRunAt,
        periodTemplate,
        nextCommand
      }
    })
  ];
  const evidence = await addStartupEvidence({
    cwd,
    type: "ops_schedule",
    summary: `Scale report schedule recorded (${cadence})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        cadence,
        owner,
        nextRunAt,
        periodTemplate,
        nextCommand
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    nextCommand
  };
}

export async function generateOpsSops(
  options: GenerateOpsSopsOptions = {}
): Promise<GenerateOpsSopsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const sops =
    options.sops === undefined || options.sops.length === 0
      ? ["No SOP input recorded; define recurring operation steps before handoff."]
      : options.sops;
  const markdown = formatOpsSops({
    generatedAt,
    sops,
    owner: options.owner ?? "unassigned",
    workflow: options.workflow ?? "unassigned"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "ops-sops.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_sop",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        sops,
        owner: options.owner ?? "unassigned",
        workflow: options.workflow ?? "unassigned"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "ops_sop",
    summary: `Ops SOPs generated (${sops.length} SOP${sops.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    sops
  };
}

export async function verifyGtmArtifacts(
  options: VerifyGtmArtifactsOptions = {}
): Promise<VerifyGtmArtifactsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const claims =
    options.claims === undefined || options.claims.length === 0
      ? ["No GTM claim input recorded; verify launch promises before publishing."]
      : options.claims;
  const markdown = formatGtmVerification({
    generatedAt,
    claims,
    evidenceRefs: options.evidenceRefs ?? [],
    productState: options.productState ?? "unrecorded"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "gtm-artifacts.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_gtm_artifact",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "gtm_artifact",
    summary: `GTM artifacts verified (${claims.length} claim${claims.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.evidenceRefs ?? [])],
    content: JSON.stringify(
      {
        markdown,
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    claims
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
  const typecheckCommand = input.inspection.commands.typecheck.detected
    ? input.inspection.commands.typecheck.command
    : "missing";
  const buildCommand = input.inspection.commands.build.detected
    ? input.inspection.commands.build.command
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
    `- Typecheck command: ${typecheckCommand}`,
    `- Build command: ${buildCommand}`,
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
    listItems([
      `test: ${testCommand}`,
      `lint: ${lintCommand}`,
      `typecheck: ${typecheckCommand}`,
      `build: ${buildCommand}`
    ]),
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

async function writeStartupStructuredArtifact(input: {
  kind: string;
  generatedAt: string;
  markdownPath: string;
  data: Record<string, unknown>;
}): Promise<string> {
  const structuredPath = structuredArtifactPath(input.markdownPath);
  const artifact: StartupStructuredArtifact = {
    schemaVersion: STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
    schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
    kind: input.kind,
    generatedAt: input.generatedAt,
    markdownPath: input.markdownPath,
    data: input.data
  };

  await writeFile(structuredPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  return structuredPath;
}

function structuredArtifactPath(markdownPath: string): string {
  return markdownPath.endsWith(".md")
    ? `${markdownPath.slice(0, -3)}.json`
    : `${markdownPath}.json`;
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

function measurementMetricDefinitions(input: {
  activationMetric?: string;
  retentionMetric?: string;
  day7Metric?: string;
  day30Metric?: string;
  falsePositiveMetric?: string;
}): Record<string, unknown>[] {
  return [
    {
      key: "activation",
      definition:
        input.activationMetric ?? "User completes the first successful core workflow.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "retention",
      definition:
        input.retentionMetric ?? "User returns and completes a core workflow again.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "d7_retention",
      definition: input.day7Metric ?? "Day 7 retained active users by signup cohort.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "d30_retention",
      definition: input.day30Metric ?? "Day 30 retained active users by signup cohort.",
      requiredSnapshotFields: ["source", "threshold", "current", "snapshotDate"]
    },
    {
      key: "false_positive",
      definition:
        input.falsePositiveMetric ??
        "Runstead or product claim is counted as success without user-confirmed value.",
      requiredSnapshotFields: ["source", "falsePositive", "snapshotDate"]
    }
  ];
}

function listItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function formatRepoReadinessAudit(input: {
  generatedAt: string;
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>;
  changedProtected: string[];
  blockers: string[];
  warnings: string[];
}): string {
  const packageManager = input.inspection.packageManager.detected
    ? `${input.inspection.packageManager.packageManager} (${input.inspection.packageManager.source})`
    : "missing";
  const ci = input.inspection.ci.detected
    ? input.inspection.ci.providers.map((provider) => provider.provider).join(", ")
    : "missing";

  return [
    "# Startup Repository Readiness Audit",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Repository Signals",
    "",
    `- Git repo: ${input.inspection.git.isGitRepo ? "yes" : "no"}`,
    `- Branch: ${input.inspection.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${formatDetectedCommand(input.inspection.commands.test)}`,
    `- Lint command: ${formatDetectedCommand(input.inspection.commands.lint)}`,
    `- Typecheck command: ${formatDetectedCommand(input.inspection.commands.typecheck)}`,
    `- Build command: ${formatDetectedCommand(input.inspection.commands.build)}`,
    `- CI: ${ci}`,
    "",
    "## Protected Path Changes",
    "",
    listItemsOrNone(input.changedProtected),
    "",
    "## Release Blockers",
    "",
    listItemsOrNone(input.blockers),
    "",
    "## Warnings",
    "",
    listItemsOrNone(input.warnings),
    "",
    "## Evidence Required Before Launch",
    "",
    listItems([
      "startup_repo_readiness from this audit",
      "startup_security_baseline from security baseline generation",
      "command_output from test, lint, typecheck, and build verifier runs",
      "startup_migration_plan if persistence or schema changes exist",
      "startup_rollback_plan for the release path",
      "startup_observability for launch monitoring"
    ]),
    ""
  ].join("\n");
}

function formatSecurityBaseline(input: {
  generatedAt: string;
  changedProtected: string[];
  envFiles: string[];
  dependencyFiles: string[];
  blockers: string[];
  warnings: string[];
}): string {
  return [
    "# Startup Security Baseline",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Protected Path Changes",
    "",
    listItemsOrNone(input.changedProtected),
    "",
    "## Local Secret And Env Files",
    "",
    listItemsOrNone(input.envFiles),
    "",
    "## Dependency Manifests",
    "",
    listItemsOrNone(input.dependencyFiles),
    "",
    "## Launch Security Blockers",
    "",
    listItemsOrNone(input.blockers),
    "",
    "## Warnings",
    "",
    listItemsOrNone(input.warnings),
    "",
    "## Release Evidence Contract",
    "",
    listItems([
      "No changed protected path may launch without explicit review evidence.",
      "Secrets must stay out of committed evidence and reports.",
      "Dependency changes require verifier evidence and rollback notes.",
      "Run startup gate check --stage launch after recording migration, rollback, and observability evidence."
    ]),
    ""
  ].join("\n");
}

function formatSupportTriage(input: {
  generatedAt: string;
  request: string;
  outcome: string;
  customer?: string;
  severity: string;
  category: string;
  sourceRefs: string[];
}): string {
  return [
    "# Startup Support Triage",
    "",
    `Generated: ${input.generatedAt}`,
    `Customer: ${input.customer ?? "unknown"}`,
    `Severity: ${input.severity}`,
    `Category: ${input.category}`,
    "",
    "## Request",
    "",
    input.request,
    "",
    "## Outcome",
    "",
    input.outcome,
    "",
    "## Source Evidence",
    "",
    listItemsOrNone(input.sourceRefs),
    "",
    "## Follow-up Contract",
    "",
    listItems([
      "Attach this triage evidence to the relevant goal, decision, or remediation task.",
      "Convert repeated support categories into product or documentation work.",
      "Re-run launch readiness after support evidence changes release risk."
    ]),
    ""
  ].join("\n");
}

function formatFounderBottleneckMap(input: {
  generatedAt: string;
  bottlenecks: string[];
  owner: string;
  systemOfRecord: string;
  status: string;
  handoffDueDate?: string;
}): string {
  return [
    "# Founder Bottleneck Map",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    `System of record: ${input.systemOfRecord}`,
    `Status: ${input.status}`,
    ...(input.handoffDueDate === undefined
      ? []
      : [`Handoff due: ${input.handoffDueDate}`]),
    "",
    "## Founder-only Bottlenecks",
    "",
    listItems(input.bottlenecks),
    "",
    "## Handoff Requirements",
    "",
    listItems([
      "Each bottleneck needs an owner or durable system of record.",
      "Credential, customer, release, and architecture knowledge must be moved into governed artifacts.",
      "Repeat this audit before scale-stage workflow delegation."
    ]),
    ""
  ].join("\n");
}

function formatWorkflowRegistry(input: {
  generatedAt: string;
  workflows: string[];
  approvalBoundaries: string[];
}): string {
  return [
    "# Startup Workflow Registry",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Recurring Workflows",
    "",
    listItems(input.workflows),
    "",
    "## Automation Coverage Contract",
    "",
    listItems([
      "Each recurring workflow needs a trigger, owner, evidence output, and verifier.",
      "Agent-run workflows must write evidence before claiming completion.",
      "Workflow changes crossing an approval boundary must create an approval request."
    ]),
    "",
    "## Approval Boundaries",
    "",
    listItems(input.approvalBoundaries),
    ""
  ].join("\n");
}

function formatDelegationPolicy(input: {
  generatedAt: string;
  delegationRules: string[];
  approvalBoundaries: string[];
  allowedAgents: string[];
  constrainedTaskTypes: string[];
}): string {
  return [
    "# Startup Delegation Policy",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Delegation Rules",
    "",
    listItems(input.delegationRules),
    "",
    "## Approval Boundaries",
    "",
    listItems(input.approvalBoundaries),
    "",
    "## Allowed Agents",
    "",
    listItems(input.allowedAgents),
    "",
    "## Constrained Task Types",
    "",
    listItems(input.constrainedTaskTypes),
    "",
    "## Audit Contract",
    "",
    listItems([
      "Agents are workers; Runstead remains the control plane.",
      "Delegated work must be linked to goals, tasks, evidence, or approvals.",
      "Founder-only decisions must move into decision records or memory artifacts before scale."
    ]),
    ""
  ].join("\n");
}

function formatInstitutionalMemory(input: {
  generatedAt: string;
  scope: string;
  knowledge: string[];
  sourceRefs: string[];
}): string {
  return [
    "# Startup Institutional Memory",
    "",
    `Generated: ${input.generatedAt}`,
    `Scope: ${input.scope}`,
    "",
    "## Captured Knowledge",
    "",
    listItems(input.knowledge),
    "",
    "## Source References",
    "",
    listItemsOrNone(input.sourceRefs),
    "",
    "## Verification Contract",
    "",
    listItems([
      "Founder-only context must become a verified project fact or decision record.",
      "Conflicting facts must be resolved before delegation.",
      "Memory retrieval must remain auditable through Runstead events."
    ]),
    ""
  ].join("\n");
}

function formatIntegrationMap(input: {
  generatedAt: string;
  integrations: string[];
  lockInSignals: string[];
  automationCoverage: string[];
  adoptionSignals: string[];
  workflowSignals: string[];
}): string {
  return [
    "# Startup Integration Depth Map",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Integrations",
    "",
    listItems(input.integrations),
    "",
    "## Workflow Lock-in Signals",
    "",
    listItemsOrNone(input.lockInSignals),
    "",
    "## Automation Coverage",
    "",
    listItemsOrNone(input.automationCoverage),
    "",
    "## Adoption Signals",
    "",
    listItemsOrNone(input.adoptionSignals),
    "",
    "## Workflow Signals",
    "",
    listItemsOrNone(input.workflowSignals),
    "",
    "## Scale Contract",
    "",
    listItems([
      "Each critical integration needs an owner, failure mode, and support path.",
      "Workflow lock-in claims need customer evidence or usage metrics.",
      "Automation coverage must map to recurring workflow registry entries."
    ]),
    ""
  ].join("\n");
}

function formatScaleOpsReport(input: {
  generatedAt: string;
  period: string;
  evidence: StartupEvidenceSummaryRow[];
  supportCategoryCounts: Record<string, number>;
}): string {
  const supportEvidence = input.evidence.filter(
    (item) => item.type === "startup_support_triage"
  );
  const engineeringEvidence = input.evidence.filter((item) =>
    [
      "startup_repo_readiness",
      "startup_security_baseline",
      "startup_workflow_registry",
      "startup_delegation_policy",
      "startup_ops_sop"
    ].includes(item.type)
  );
  const gtmEvidence = input.evidence.filter((item) =>
    ["startup_customer_interview", "startup_metric", "startup_gtm_artifact"].includes(
      item.type
    )
  );

  return [
    "# Startup Scale Ops Report",
    "",
    `Generated: ${input.generatedAt}`,
    `Period: ${input.period}`,
    "",
    "## Weekly Ops Evidence",
    "",
    formatEvidenceSummary(supportEvidence),
    "",
    "## Support Category Aggregation",
    "",
    formatCategoryCounts(input.supportCategoryCounts),
    "",
    "## Weekly Engineering Evidence",
    "",
    formatEvidenceSummary(engineeringEvidence),
    "",
    "## Weekly GTM Evidence",
    "",
    formatEvidenceSummary(gtmEvidence),
    "",
    "## Recent Startup Evidence",
    "",
    formatEvidenceSummary(input.evidence.slice(0, 10)),
    "",
    "## Recurring Report Contract",
    "",
    listItems([
      "Ops, engineering, and GTM sections must cite Runstead evidence.",
      "Missing evidence should become the next scale-stage task.",
      "This report should be regenerated before weekly planning."
    ]),
    ""
  ].join("\n");
}

function formatScaleReportSchedule(input: {
  generatedAt: string;
  cadence: string;
  owner: string;
  nextRunAt: string;
  periodTemplate: string;
  nextCommand: string;
}): string {
  return [
    "# Startup Scale Report Schedule",
    "",
    `Generated: ${input.generatedAt}`,
    `Cadence: ${input.cadence}`,
    `Owner: ${input.owner}`,
    `Next run: ${input.nextRunAt}`,
    `Period template: ${input.periodTemplate}`,
    `Command: ${input.nextCommand}`,
    "",
    "## Recurrence Contract",
    "",
    listItems([
      "Generate the scale report on the recorded cadence.",
      "Attach generated reports as startup_ops_report evidence.",
      "Review overdue handoffs, support categories, delegation constraints, memory retrieval, integrations, and GTM claims."
    ]),
    ""
  ].join("\n");
}

function formatOpsSops(input: {
  generatedAt: string;
  sops: string[];
  owner: string;
  workflow: string;
}): string {
  return [
    "# Startup Ops SOPs",
    "",
    `Generated: ${input.generatedAt}`,
    `Owner: ${input.owner}`,
    `Workflow: ${input.workflow}`,
    "",
    "## SOPs",
    "",
    listItems(input.sops),
    "",
    "## Handoff Checklist",
    "",
    listItems([
      "Each SOP must define trigger, inputs, steps, evidence output, owner, and escalation path.",
      "Agent-executed SOPs must write evidence before completion.",
      "Publishing or external writes still follow delegation policy approval boundaries."
    ]),
    ""
  ].join("\n");
}

function formatGtmVerification(input: {
  generatedAt: string;
  claims: string[];
  evidenceRefs: string[];
  productState: string;
}): string {
  return [
    "# Startup GTM Artifact Verification",
    "",
    `Generated: ${input.generatedAt}`,
    `Product state: ${input.productState}`,
    "",
    "## Claims",
    "",
    listItems(input.claims),
    "",
    "## Evidence References",
    "",
    listItemsOrNone(input.evidenceRefs),
    "",
    "## Publish Contract",
    "",
    listItems([
      "Every external GTM claim needs customer, metric, or product-state evidence.",
      "Claims that exceed current product state must be blocked before publish.",
      "Publishing GTM artifacts requires approval under the startup delegation policy."
    ]),
    ""
  ].join("\n");
}

function formatEvidenceSummary(evidence: StartupEvidenceSummaryRow[]): string {
  return evidence.length === 0
    ? "- none"
    : evidence
        .map((item) => `- ${item.id}: ${item.type}: ${item.summary ?? "no summary"}`)
        .join("\n");
}

function formatCategoryCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return entries.length === 0
    ? "- none"
    : entries.map(([category, count]) => `- ${category}: ${count}`).join("\n");
}

function supportCategoryCountsFromArtifacts(
  artifacts: StartupArtifactListItem[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of artifacts) {
    if (item.kind !== "startup_support_triage") {
      continue;
    }

    const category =
      typeof item.artifact.data.category === "string"
        ? item.artifact.data.category
        : "uncategorized";

    counts[category] = (counts[category] ?? 0) + 1;
  }

  return counts;
}

function readStartupEvidenceSummaries(
  database: ReturnType<typeof openRunsteadDatabase>
): StartupEvidenceSummaryRow[] {
  return database
    .prepare(
      `
      SELECT id, type, summary, created_at
      FROM evidence
      WHERE type LIKE 'startup_%'
      ORDER BY created_at DESC, id ASC
      LIMIT 50
    `
    )
    .all() as unknown as StartupEvidenceSummaryRow[];
}

function repoReadinessBlockers(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>,
  changedProtected: string[]
): string[] {
  return [
    ...(inspection.commands.test.detected ? [] : ["test command is missing"]),
    ...(inspection.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(inspection.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(inspection.commands.build.detected ? [] : ["build command is missing"]),
    ...(inspection.ci.detected ? [] : ["CI configuration is missing"]),
    ...(changedProtected.length === 0
      ? []
      : [`protected path changes require review: ${changedProtected.join(", ")}`])
  ];
}

function repoReadinessWarnings(
  inspection: Awaited<ReturnType<typeof collectRepoInspection>>
): string[] {
  return [
    ...(inspection.git.isGitRepo ? [] : ["workspace is not a Git repository"]),
    ...(inspection.packageManager.detected
      ? []
      : ["package manager could not be detected"])
  ];
}

function securityBaselineBlockers(changedProtected: string[]): string[] {
  return changedProtected.length === 0
    ? []
    : [`protected path changes require review: ${changedProtected.join(", ")}`];
}

function securityBaselineWarnings(input: {
  envFiles: string[];
  dependencyFiles: string[];
}): string[] {
  return [
    ...(input.envFiles.length === 0
      ? []
      : [`local env files present: ${input.envFiles.join(", ")}`]),
    ...(input.dependencyFiles.length === 0
      ? ["no dependency manifest or lockfile detected"]
      : [])
  ];
}

function formatDetectedCommand(command: {
  detected: boolean;
  command?: string;
}): string {
  return command.detected ? (command.command ?? "detected") : "missing";
}

function listItemsOrNone(items: string[]): string {
  return items.length === 0 ? "- none" : listItems(items);
}

async function changedProtectedPaths(cwd: string): Promise<string[]> {
  const changedPaths = await changedGitPaths(cwd);

  return changedPaths
    .filter((path) =>
      PROTECTED_PATH_PATTERNS.some((pattern) => matchesPolicyPathPattern(path, pattern))
    )
    .sort((left, right) => left.localeCompare(right));
}

async function changedGitPaths(cwd: string): Promise<string[]> {
  try {
    const result = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });

    return result.stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 3)
      .map((line) => normalizeStatusPath(line.slice(3)))
      .filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

function normalizeStatusPath(value: string): string {
  const renameSeparator = " -> ";
  const renamedPath = value.includes(renameSeparator)
    ? value.slice(value.lastIndexOf(renameSeparator) + renameSeparator.length)
    : value;

  return renamedPath.replace(/^"|"$/g, "");
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

async function findTopLevelEnvFiles(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && /^\.env($|\.)/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function existingDependencyFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];

  for (const filename of DEPENDENCY_FILES) {
    if (await exists(join(cwd, filename))) {
      files.push(filename);
    }
  }

  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
