import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Goal } from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { installDomainPack, upgradeDomainPack } from "./domain-pack-install.js";
import { createGoal, listGoals } from "./goals.js";
import { initRunstead, type InitPolicyProfile } from "./init.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import {
  contextForFile,
  formatFounderBottleneckMap,
  formatGtmVerification,
  formatInstitutionalMemory,
  formatIntegrationMap,
  formatMeasurementFramework,
  formatOpsSops,
  formatRepoReadinessAudit,
  formatScaleOpsReport,
  formatScaleReportSchedule,
  formatScaleStarterPack,
  formatSecurityBaseline,
  formatStartupAgentContext,
  formatSupportTriage,
  formatWorkflowRegistry,
  formatDelegationPolicy,
  measurementMetricDefinitions,
  safeTimestamp,
  startupContextEvidenceSummary
} from "./startup-automation-format.js";
import {
  recordProjectFact,
  retrieveProjectFacts,
  type RetrieveProjectFactsResult
} from "./memory.js";
import { resolveRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import {
  listStartupArtifacts,
  stableRepoInspectionData,
  stableStartupGeneratedAt,
  structuredArtifactFileName,
  writeStartupStructuredArtifact,
  writeTextFileIfChanged
} from "./startup-artifacts.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import { collectLaunchSecurityRiskScan } from "./startup-security-scan.js";
import {
  changedProtectedPaths,
  existingDependencyFiles,
  exists,
  findTopLevelEnvFiles
} from "./startup-workspace-hygiene.js";
import {
  readStartupEvidenceSummaries,
  supportCategoryCountsFromArtifacts,
  type StartupEvidenceSummaryRow
} from "./startup-evidence-summary.js";
import {
  repoReadinessBlockers,
  repoReadinessWarnings,
  securityBaselineBlockers,
  securityBaselineWarnings
} from "./startup-readiness-gates.js";
import type {
  CaptureInstitutionalMemoryOptions,
  CaptureInstitutionalMemoryResult,
  GenerateFounderBottleneckMapOptions,
  GenerateFounderBottleneckMapResult,
  GenerateIntegrationMapOptions,
  GenerateIntegrationMapResult,
  GenerateMeasurementFrameworkOptions,
  GenerateMeasurementFrameworkResult,
  GenerateOpsSopsOptions,
  GenerateOpsSopsResult,
  GenerateRepoReadinessAuditOptions,
  GenerateRepoReadinessAuditResult,
  GenerateScaleOpsReportOptions,
  GenerateScaleOpsReportResult,
  GenerateScaleStarterPackOptions,
  GenerateScaleStarterPackResult,
  GenerateSecurityBaselineOptions,
  GenerateSecurityBaselineResult,
  GenerateStartupContextOptions,
  GenerateStartupContextResult,
  GenerateWorkflowRegistryOptions,
  GenerateWorkflowRegistryResult,
  RecordSupportTriageOptions,
  RecordSupportTriageResult,
  RetrieveStartupInstitutionalMemoryOptions,
  ScheduleScaleReportOptions,
  ScheduleScaleReportResult,
  StartupInitOptions,
  StartupInitResult,
  StartupInitStage,
  VerifyGtmArtifactsOptions,
  VerifyGtmArtifactsResult
} from "./startup-automation-types.js";

export type * from "./startup-automation-types.js";

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
  const files: string[] = [];
  const structuredFiles: string[] = [];
  const contentBlocks: string[] = [];
  let generatedCount = 0;
  let ingestedCount = 0;
  const contextData = {
    contextFiles: STARTUP_CONTEXT_FILES,
    inspection: stableRepoInspectionData(inspection),
    architecturePrinciples: options.architecturePrinciples ?? [],
    technicalConstraints: options.technicalConstraints ?? [],
    acceptedDebt: options.acceptedDebt ?? []
  };
  await mkdir(join(state.root, "startup"), { recursive: true });

  if (options.currentOnly === true) {
    const currentPath = join(state.root, "startup", "current-agent-context.md");
    const currentData = {
      ...contextData,
      contextFile: "current-agent-context.md",
      contextScope: "current"
    };
    const contextGeneratedAt = await stableStartupGeneratedAt({
      kind: "startup_agent_context",
      markdownPath: currentPath,
      data: currentData,
      fallback: generatedAt
    });
    const context = formatStartupAgentContext({
      generatedAt: contextGeneratedAt,
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

    await writeTextFileIfChanged(currentPath, context);
    structuredFiles.push(
      await writeStartupStructuredArtifact({
        kind: "startup_agent_context",
        generatedAt: contextGeneratedAt,
        markdownPath: currentPath,
        data: currentData
      })
    );

    const evidence = await addStartupEvidence({
      cwd,
      type: "agent_context",
      summary: "Refreshed current startup agent context",
      sourceRefs: [currentPath, ...structuredFiles],
      content: context,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    return {
      root: state.root,
      stateDb: state.stateDb,
      files: [currentPath],
      structuredFiles,
      evidenceId: evidence.evidence.id
    };
  }

  const summaryPath = join(state.root, "startup", "agent-context.md");
  const summaryData = {
    ...contextData,
    contextFile: "agent-context.md",
    contextScope: "initial"
  };
  const contextGeneratedAt = await stableStartupGeneratedAt({
    kind: "startup_agent_context",
    markdownPath: summaryPath,
    data: summaryData,
    fallback: generatedAt
  });
  const context = formatStartupAgentContext({
    generatedAt: contextGeneratedAt,
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

  for (const filename of STARTUP_CONTEXT_FILES) {
    const path = join(cwd, filename);
    let fileContent: string;
    let ingested = false;

    if (options.force !== true && (await exists(path))) {
      fileContent = await readFile(path, "utf8");
      ingested = true;
      ingestedCount += 1;
    } else {
      fileContent = contextForFile(filename, context);
      await writeTextFileIfChanged(path, fileContent);
      generatedCount += 1;
    }

    files.push(path);
    contentBlocks.push(`## ${filename}\n\n${fileContent}`);
    structuredFiles.push(
      await writeStartupStructuredArtifact({
        kind: "startup_agent_context",
        generatedAt: contextGeneratedAt,
        markdownPath: path,
        ...(options.writeTrackedContext === true
          ? {}
          : {
              structuredPath: join(
                state.root,
                "startup",
                "tracked-context",
                structuredArtifactFileName(filename)
              )
            }),
        data: {
          ...contextData,
          contextFile: filename,
          contextScope: "initial",
          ingested
        }
      })
    );
  }

  await writeTextFileIfChanged(summaryPath, context);
  structuredFiles.push(
    await writeStartupStructuredArtifact({
      kind: "startup_agent_context",
      generatedAt: contextGeneratedAt,
      markdownPath: summaryPath,
      data: summaryData
    })
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "agent_context",
    summary: startupContextEvidenceSummary({ generatedCount, ingestedCount }),
    sourceRefs: [...files, summaryPath, ...structuredFiles],
    content: ingestedCount > 0 ? contentBlocks.join("\n\n") : context,
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
  const rootPath = join(cwd, "MEASUREMENT.md");
  const rootPathExists = await exists(rootPath);

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
  const measurementGeneratedAt = await stableStartupGeneratedAt({
    kind: "startup_measurement_framework",
    markdownPath: runtimePath,
    data: {
      ...measurementData,
      ingested: rootPathExists && options.force !== true
    },
    fallback: generatedAt
  });
  const generatedFramework = formatMeasurementFramework({
    generatedAt: measurementGeneratedAt,
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
  const framework =
    rootPathExists && options.force !== true
      ? await readFile(rootPath, "utf8")
      : generatedFramework;

  if (!rootPathExists || options.force === true) {
    await writeTextFileIfChanged(rootPath, framework);
  }

  await writeTextFileIfChanged(runtimePath, framework);
  const structuredFiles = await Promise.all(
    [
      {
        markdownPath: rootPath,
        ...(options.writeTrackedContext === true
          ? {}
          : {
              structuredPath: join(
                state.root,
                "startup",
                "tracked-context",
                "MEASUREMENT.json"
              )
            })
      },
      { markdownPath: runtimePath }
    ].map((path) =>
      writeStartupStructuredArtifact({
        kind: "startup_measurement_framework",
        generatedAt: measurementGeneratedAt,
        markdownPath: path.markdownPath,
        ...(path.structuredPath === undefined
          ? {}
          : { structuredPath: path.structuredPath }),
        data: {
          ...measurementData,
          ingested: rootPathExists && options.force !== true
        }
      })
    )
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "measurement_framework",
    summary:
      rootPathExists && options.force !== true
        ? "Ingested existing startup measurement framework"
        : "Generated startup measurement framework",
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
  const riskScan = await collectLaunchSecurityRiskScan(cwd, dependencyFiles);
  const blockers = securityBaselineBlockers(changedProtected, riskScan);
  const warnings = securityBaselineWarnings({ envFiles, dependencyFiles, riskScan });
  const markdown = formatSecurityBaseline({
    generatedAt,
    changedProtected,
    envFiles,
    dependencyFiles,
    riskScan,
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
        riskScan,
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
    warnings,
    riskScan
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
  const scaleGate = await checkStartupGate({
    cwd,
    stage: "scale",
    recordEvent: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const markdown = formatScaleOpsReport({
    generatedAt,
    period,
    evidence,
    supportCategoryCounts,
    blockers: scaleGate.blockers
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
        supportCategoryCounts,
        blockers: scaleGate.blockers
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

export async function generateScaleStarterPack(
  options: GenerateScaleStarterPackOptions = {}
): Promise<GenerateScaleStarterPackResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const owner = options.owner ?? "founder";
  const workflow = await generateWorkflowRegistry({
    cwd,
    workflows: [
      "Weekly evidence-backed scale readiness review",
      "Support triage and escalation",
      "Launch metric review and anomaly follow-up",
      "GTM claim review before external publishing"
    ],
    delegationRules: [
      "Agents may draft scale artifacts; founder approval is required before external publishing.",
      "Support automation may classify requests; high-severity incidents require owner review.",
      "Metric interpretation must cite source class, freshness, and evidence id."
    ],
    approvalBoundaries: [
      "external publishing",
      "billing or pricing changes",
      "high-severity customer support closure"
    ],
    allowedAgents: ["codex_cli", "codex_direct"],
    constrainedTaskTypes: [
      "startup_scale_report",
      "support_triage",
      "gtm_artifact_review"
    ],
    now
  });
  const support = await recordSupportTriage({
    cwd,
    request: "Scale starter support triage template",
    outcome:
      "Route onboarding friction, product defects, billing issues, and security incidents to named owners before scale delegation.",
    customer: "starter-template",
    severity: "medium",
    category: "scale_readiness",
    sourceRefs: workflow.files,
    now
  });
  const schedule = await scheduleScaleReport({
    cwd,
    cadence: "weekly",
    owner,
    nextRunAt: generatedAt.slice(0, 10),
    periodTemplate: "YYYY-WW",
    now
  });
  const sops = await generateOpsSops({
    cwd,
    owner,
    workflow: "scale readiness operations",
    sops: [
      "Generate the startup scale report every week and review every blocker.",
      "Check support categories for repeated onboarding friction before delegation.",
      "Refresh metric snapshots and confirm source class before GTM claims are reused.",
      "Escalate billing, privacy, security, and external publishing changes for approval."
    ],
    now
  });
  const gtm = await verifyGtmArtifacts({
    cwd,
    claims: [
      "Public launch copy is backed by current product evidence.",
      "Scale claims are not published until workflow, support, SOP, and metrics evidence are current."
    ],
    evidenceRefs: [...workflow.evidenceIds, support.evidenceId, sops.evidenceId],
    productState: "scale starter pack generated; scale-ready status is not granted",
    now
  });
  const scaleGate = await checkStartupGate({
    cwd,
    stage: "scale",
    recordEvent: false,
    now
  });
  const files = [
    ...workflow.files,
    ...support.files,
    ...schedule.files,
    ...sops.files,
    ...gtm.files
  ];
  const structuredFiles = [
    ...workflow.structuredFiles,
    ...support.structuredFiles,
    ...schedule.structuredFiles,
    ...sops.structuredFiles,
    ...gtm.structuredFiles
  ];
  const evidenceIds = [
    ...workflow.evidenceIds,
    support.evidenceId,
    schedule.evidenceId,
    sops.evidenceId,
    gtm.evidenceId
  ];
  const nextCommands = [
    "runstead startup scale-check",
    "runstead startup scale report",
    "runstead startup remediate --stage scale --execute --worker codex_cli"
  ];
  const summaryPath = join(state.root, "startup", "scale-starter-pack.md");
  const markdown = formatScaleStarterPack({
    generatedAt,
    owner,
    files,
    evidenceIds,
    blockers: scaleGate.blockers,
    nextCommands
  });

  await mkdir(join(state.root, "startup"), { recursive: true });
  await writeFile(summaryPath, markdown, "utf8");
  const structuredPath = await writeStartupStructuredArtifact({
    kind: "startup_scale_starter_pack",
    generatedAt,
    markdownPath: summaryPath,
    data: {
      owner,
      files: [summaryPath, ...files],
      evidenceIds,
      blockers: scaleGate.blockers,
      scaleReady: false,
      nextCommands
    }
  });
  const starterEvidence = await addStartupEvidence({
    cwd,
    type: "scale_starter_pack",
    summary: "Scale starter pack generated; scale-ready status is not granted",
    sourceRefs: [summaryPath, structuredPath, ...files],
    content: JSON.stringify(
      {
        markdown,
        owner,
        files: [summaryPath, ...files],
        evidenceIds,
        blockers: scaleGate.blockers,
        scaleReady: false,
        nextCommands
      },
      null,
      2
    ),
    now
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [summaryPath, ...files],
    structuredFiles: [structuredPath, ...structuredFiles],
    evidenceIds: [starterEvidence.evidence.id, ...evidenceIds],
    scaleReady: false,
    blockers: scaleGate.blockers,
    nextCommands
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
