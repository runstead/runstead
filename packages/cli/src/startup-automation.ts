import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { installDomainPack, upgradeDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import {
  formatMeasurementFramework,
  formatRepoReadinessAudit,
  formatSecurityBaseline,
  measurementMetricDefinitions
} from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  ensureRunsteadInitialized,
  findActiveStartupGoal,
  STARTUP_DOMAIN,
  templateForStage
} from "./startup-automation-init.js";
import {
  stableStartupGeneratedAt,
  writeStartupStructuredArtifact,
  writeTextFileIfChanged
} from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { collectLaunchSecurityRiskScan } from "./startup-security-scan.js";
import {
  changedProtectedPaths,
  existingDependencyFiles,
  exists,
  findTopLevelEnvFiles
} from "./startup-workspace-hygiene.js";
import {
  repoReadinessBlockers,
  repoReadinessWarnings,
  securityBaselineBlockers,
  securityBaselineWarnings
} from "./startup-readiness-gates.js";
import type {
  GenerateMeasurementFrameworkOptions,
  GenerateMeasurementFrameworkResult,
  GenerateRepoReadinessAuditOptions,
  GenerateRepoReadinessAuditResult,
  GenerateSecurityBaselineOptions,
  GenerateSecurityBaselineResult,
  StartupInitOptions,
  StartupInitResult
} from "./startup-automation-types.js";

export type * from "./startup-automation-types.js";
export { generateStartupContext } from "./startup-automation-context.js";

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

export {
  captureInstitutionalMemory,
  generateFounderBottleneckMap,
  generateIntegrationMap,
  generateOpsSops,
  generateScaleOpsReport,
  generateScaleStarterPack,
  generateWorkflowRegistry,
  recordSupportTriage,
  retrieveStartupInstitutionalMemory,
  scheduleScaleReport,
  verifyGtmArtifacts
} from "./startup-scale-automation.js";
