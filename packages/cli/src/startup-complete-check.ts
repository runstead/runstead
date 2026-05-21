import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { buildDashboard, type BuildDashboardResult } from "./dashboard.js";
import {
  collectRepoInspection,
  type RepoInspectionSnapshot
} from "./inspection-evidence.js";
import {
  generateLaunchReadinessReport,
  type LaunchReadinessReportResult
} from "./launch-readiness-report.js";
import {
  generateOpsDiagnosticsBundle,
  type OpsDiagnosticsBundleResult
} from "./ops-diagnostics.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
  STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION
} from "./startup-artifacts.js";
import {
  generateStartupCiSummary,
  type GenerateStartupCiSummaryResult
} from "./startup-ci-integration.js";
import {
  addStartupEvidence,
  checkStartupGate,
  type StartupGateCheckResult,
  type StartupGateFindingSeverity
} from "./startup-evidence.js";
import {
  generateStartupRemediationPlan,
  type GenerateStartupRemediationPlanResult
} from "./startup-remediation.js";
import { getStartupStatus, type StartupStatusResult } from "./startup-status.js";

export interface GenerateStartupCompleteProductCheckOptions {
  cwd?: string;
  domain?: string;
  now?: Date;
}

export interface StartupCompleteProductCheckResult {
  root: string;
  stateDb: string;
  domain: string;
  generatedAt: string;
  status: StartupCompleteProductStatus;
  score: number;
  markdownPath: string;
  jsonPath: string;
  markdown: string;
  event: RunsteadEvent;
  evidenceId: string;
  criteria: StartupCompleteProductCriterion[];
  blockers: StartupCompleteProductBlockerAudit[];
  surfaces: StartupCompleteProductSurfaces;
}

export type StartupCompleteProductStatus = "complete" | "incomplete";
export type StartupCompleteProductCriterionStatus = "passed" | "blocked";

export interface StartupCompleteProductCriterion {
  id: string;
  title: string;
  status: StartupCompleteProductCriterionStatus;
  severity: "critical" | "major";
  evidence: string[];
  missing: string[];
  nextAction: string;
}

export interface StartupCompleteProductBlockerAudit {
  blocker: string;
  severity: StartupGateFindingSeverity;
  owner: string;
  remediationTask: string;
  evidenceSources: string[];
}

export interface StartupCompleteProductSurfaces {
  launchReportMarkdown: string;
  launchReportJson: string;
  ciMarkdown: string;
  ciJson: string;
  dashboardHtml: string;
  dashboardJson: string;
  diagnosticsMarkdown: string;
  diagnosticsJson: string;
  completeCheckMarkdown: string;
  completeCheckJson: string;
  evidenceId: string;
  eventId: string;
}

interface EvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface EventCountRow {
  count: number;
}

interface StartupEvidenceArtifact {
  associations?: unknown;
  remediation?: unknown;
}

const STARTUP_DOMAIN = "ai-native-startup";
const REQUIRED_STARTUP_EVIDENCE = [
  "startup_agent_context",
  "startup_measurement_framework",
  "startup_metric_snapshot",
  "startup_repo_readiness",
  "startup_security_baseline",
  "startup_migration_plan",
  "startup_rollback_plan",
  "startup_observability",
  "startup_founder_bottleneck"
];

export async function generateStartupCompleteProductCheck(
  options: GenerateStartupCompleteProductCheckOptions = {}
): Promise<StartupCompleteProductCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const state = await requireRunsteadStateDb(cwd);
  const markdownPath = join(state.root, "reports", "startup-complete-product-check.md");
  const jsonPath = join(state.root, "reports", "startup-complete-product-check.json");
  const repo = await collectRepoInspection(cwd, generatedAt);
  const status = await getStartupStatus({ cwd, domain, now });
  const remediation = await generateStartupRemediationPlan({ cwd, domain, now });
  const launchReport = await generateLaunchReadinessReport({ cwd, domain, now });
  const ci = await generateStartupCiSummary({ cwd, domain, stage: "launch", now });
  const dashboard = await buildDashboard({ cwd, now });
  const diagnostics = await generateOpsDiagnosticsBundle({
    cwd,
    includeStateBackup: true,
    now
  });
  const gate = await checkStartupGate({
    cwd,
    domain,
    stage: "launch",
    now,
    recordEvent: false
  });
  const evidenceRows = readStartupEvidenceRows(state.stateDb);
  const eventCount = readEventCount(state.stateDb);
  const pathState = await existingPathState([
    launchReport.reportPath,
    launchReport.jsonPath,
    ci.markdownPath,
    ci.jsonPath,
    dashboard.htmlPath,
    dashboard.dataPath,
    diagnostics.markdownPath,
    diagnostics.jsonPath,
    ...(diagnostics.stateBackupPath === undefined ? [] : [diagnostics.stateBackupPath])
  ]);
  const blockers = startupCompleteProductBlockers({
    gate,
    launchReport,
    evidenceRows
  });
  const baseCriteria = startupCompleteProductBaseCriteria({
    repo,
    status,
    launchReport,
    remediation,
    ci,
    dashboard,
    diagnostics,
    evidenceRows,
    blockers,
    eventCount,
    pathState
  });
  const baseStatus = completeProductStatus(baseCriteria);
  const eventId = createRunsteadId("evt");
  const evidence = await addStartupEvidence({
    cwd,
    type: "complete_product_check",
    summary: `Startup complete product check: ${baseStatus}`,
    sourceRefs: [
      markdownPath,
      jsonPath,
      launchReport.reportPath,
      launchReport.jsonPath,
      ci.markdownPath,
      ci.jsonPath,
      dashboard.htmlPath,
      dashboard.dataPath,
      diagnostics.markdownPath,
      diagnostics.jsonPath
    ],
    content: JSON.stringify(
      {
        domain,
        status: baseStatus,
        criteria: baseCriteria.map((criterion) => ({
          id: criterion.id,
          status: criterion.status
        }))
      },
      null,
      2
    ),
    now
  });
  const surfaces: StartupCompleteProductSurfaces = {
    launchReportMarkdown: launchReport.reportPath,
    launchReportJson: launchReport.jsonPath,
    ciMarkdown: ci.markdownPath,
    ciJson: ci.jsonPath,
    dashboardHtml: dashboard.htmlPath,
    dashboardJson: dashboard.dataPath,
    diagnosticsMarkdown: diagnostics.markdownPath,
    diagnosticsJson: diagnostics.jsonPath,
    completeCheckMarkdown: markdownPath,
    completeCheckJson: jsonPath,
    evidenceId: evidence.evidence.id,
    eventId
  };
  const criteria = [...baseCriteria, startupCompleteProductArtifactCriterion(surfaces)];
  const finalStatus = completeProductStatus(criteria);
  const score = completeProductScore(criteria);
  const event = startupCompleteProductEvent({
    eventId,
    domain,
    generatedAt,
    status: finalStatus,
    score,
    markdownPath,
    jsonPath,
    evidenceId: evidence.evidence.id,
    criteria,
    blockers,
    launchReport,
    ci,
    remediation,
    diagnostics
  });
  const result: StartupCompleteProductCheckResult = {
    root: state.root,
    stateDb: state.stateDb,
    domain,
    generatedAt,
    status: finalStatus,
    score,
    markdownPath,
    jsonPath,
    markdown: "",
    event,
    evidenceId: evidence.evidence.id,
    criteria,
    blockers,
    surfaces
  };
  const markdown = formatStartupCompleteProductCheck(result);

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    `${JSON.stringify(startupCompleteProductJson({ result, launchReport, ci, remediation, diagnostics }), null, 2)}\n`,
    "utf8"
  );

  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    ...result,
    markdown
  };
}

export function formatStartupCompleteProductCheck(
  result: StartupCompleteProductCheckResult
): string {
  return [
    "# Runstead Startup Complete Product Check",
    "",
    `Domain: ${result.domain}`,
    `Generated: ${result.generatedAt}`,
    `Status: ${result.status}`,
    `Score: ${Math.round(result.score * 100)}%`,
    `Evidence: ${result.evidenceId}`,
    `Event: ${result.event.eventId}`,
    "",
    "## Criteria",
    "",
    ...result.criteria.flatMap((criterion) => [
      `### ${criterion.title}`,
      "",
      `- Status: ${criterion.status}`,
      `- Severity: ${criterion.severity}`,
      `- Evidence: ${criterion.evidence.length === 0 ? "none" : criterion.evidence.join("; ")}`,
      `- Missing: ${criterion.missing.length === 0 ? "none" : criterion.missing.join("; ")}`,
      `- Next action: ${criterion.nextAction}`,
      ""
    ]),
    "## Blocker Accountability",
    "",
    listOrNone(
      result.blockers,
      (blocker) =>
        `- [${blocker.severity}] ${blocker.blocker}; owner=${blocker.owner}; remediation=${blocker.remediationTask}; sources=${blocker.evidenceSources.join(", ")}`
    ),
    "",
    "## Review Surfaces",
    "",
    ...Object.entries(result.surfaces).map(([key, value]) => `- ${key}: ${value}`),
    ""
  ].join("\n");
}

function startupCompleteProductBaseCriteria(input: {
  repo: RepoInspectionSnapshot;
  status: StartupStatusResult;
  launchReport: LaunchReadinessReportResult;
  remediation: GenerateStartupRemediationPlanResult;
  ci: GenerateStartupCiSummaryResult;
  dashboard: BuildDashboardResult;
  diagnostics: OpsDiagnosticsBundleResult;
  evidenceRows: EvidenceRow[];
  blockers: StartupCompleteProductBlockerAudit[];
  eventCount: number;
  pathState: Map<string, boolean>;
}): StartupCompleteProductCriterion[] {
  const evidenceTypes = new Set(input.evidenceRows.map((item) => item.type));
  const sourceKinds = new Set(input.status.evidence.sourceKinds);
  const missingStartupEvidence = REQUIRED_STARTUP_EVIDENCE.filter(
    (type) => !evidenceTypes.has(type)
  );
  const repoDiscoveryMissing = [
    ...(input.repo.packageManager.detected ? [] : ["package manager"]),
    ...(input.repo.commands.test.detected ? [] : ["test command"]),
    ...(input.repo.commands.lint.detected ? [] : ["lint command"]),
    ...(input.repo.commands.typecheck.detected ? [] : ["typecheck command"]),
    ...(input.repo.commands.build.detected ? [] : ["build command"]),
    ...(input.repo.ci.detected ? [] : ["CI config"]),
    ...(evidenceTypes.has("startup_repo_readiness") ? [] : ["repo readiness evidence"]),
    ...(evidenceTypes.has("startup_security_baseline")
      ? []
      : ["security baseline evidence"]),
    ...(evidenceTypes.has("startup_release_plan") || sourceKinds.has("deployment")
      ? []
      : ["deployment or release-plan evidence"])
  ];
  const reviewSurfaceMissing = missingPaths(input.pathState, [
    input.launchReport.reportPath,
    input.launchReport.jsonPath,
    input.ci.markdownPath,
    input.ci.jsonPath,
    input.dashboard.htmlPath,
    input.dashboard.dataPath,
    input.diagnostics.markdownPath,
    input.diagnostics.jsonPath
  ]);
  const diagnosticsMissing = [
    ...(input.diagnostics.stateBackupPath === undefined
      ? ["state backup"]
      : missingPaths(input.pathState, [input.diagnostics.stateBackupPath])),
    ...(input.eventCount > 0 ? [] : ["audit events"])
  ];
  const criteria = [
    criterion({
      id: "founder_golden_path",
      title: "Founder Golden Path",
      status:
        missingStartupEvidence.filter((type) =>
          ["startup_agent_context", "startup_measurement_framework"].includes(type)
        ).length === 0 && input.status.nextAction.command.trim().length > 0,
      severity: "critical",
      evidence: [
        input.status.nextAction.command,
        ...input.evidenceRows
          .filter((item) =>
            ["startup_agent_context", "startup_measurement_framework"].includes(
              item.type
            )
          )
          .map((item) => item.id)
      ],
      missing: missingStartupEvidence.filter((type) =>
        ["startup_agent_context", "startup_measurement_framework"].includes(type)
      ),
      nextAction: input.status.nextAction.command
    }),
    criterion({
      id: "repo_discovery_and_risk",
      title: "Repo Discovery And Risk",
      status: repoDiscoveryMissing.length === 0,
      severity: "critical",
      evidence: [
        `packageManager=${input.repo.packageManager.detected ? input.repo.packageManager.packageManager : "missing"}`,
        `ci=${input.repo.ci.detected ? input.repo.ci.providers.map((provider) => provider.provider).join(",") : "missing"}`,
        ...input.evidenceRows
          .filter((item) =>
            ["startup_repo_readiness", "startup_security_baseline"].includes(item.type)
          )
          .map((item) => item.id)
      ],
      missing: repoDiscoveryMissing,
      nextAction:
        "runstead startup onboard --write-ci && runstead startup launch prepare"
    }),
    criterion({
      id: "launch_readiness_report",
      title: "Launch Readiness Report",
      status:
        ["launch_ready", "blocked"].includes(input.launchReport.status) &&
        input.pathState.get(input.launchReport.reportPath) === true &&
        input.pathState.get(input.launchReport.jsonPath) === true,
      severity: "critical",
      evidence: [
        input.launchReport.reportPath,
        input.launchReport.jsonPath,
        `status=${input.launchReport.status}`,
        `trust=${Math.round(input.launchReport.trustSummary.qualityScore * 100)}%`
      ],
      missing: missingPaths(input.pathState, [
        input.launchReport.reportPath,
        input.launchReport.jsonPath
      ]),
      nextAction: "runstead startup launch report --print"
    }),
    criterion({
      id: "blocker_accountability",
      title: "Blocker Accountability",
      status: input.blockers.every(
        (blocker) =>
          blocker.owner.length > 0 &&
          blocker.remediationTask.length > 0 &&
          blocker.evidenceSources.length > 0
      ),
      severity: "critical",
      evidence: input.blockers.flatMap((blocker) => blocker.evidenceSources),
      missing: input.blockers
        .filter(
          (blocker) =>
            blocker.owner.length === 0 ||
            blocker.remediationTask.length === 0 ||
            blocker.evidenceSources.length === 0
        )
        .map((blocker) => blocker.blocker),
      nextAction: "runstead startup gate check --stage launch"
    }),
    criterion({
      id: "remediation_loop",
      title: "Remediation Loop",
      status:
        input.remediation.status === "clear" ||
        input.remediation.tasks.every((item) => item.acceptanceCriteria.length > 0),
      severity: "critical",
      evidence: [
        `status=${input.remediation.status}`,
        ...input.remediation.tasks.map((item) => item.task.id)
      ],
      missing:
        input.remediation.status === "clear"
          ? []
          : input.remediation.tasks
              .filter((item) => item.acceptanceCriteria.length === 0)
              .map((item) => item.blocker),
      nextAction:
        "runstead startup remediate --stage launch --execute --worker codex_cli"
    }),
    criterion({
      id: "review_surfaces",
      title: "Dashboard Markdown JSON Review",
      status: reviewSurfaceMissing.length === 0,
      severity: "major",
      evidence: [
        input.dashboard.htmlPath,
        input.dashboard.dataPath,
        input.launchReport.reportPath,
        input.launchReport.jsonPath
      ],
      missing: reviewSurfaceMissing,
      nextAction: "runstead dashboard build && runstead startup launch report"
    }),
    criterion({
      id: "ci_pr_gate",
      title: "CI PR Gate",
      status:
        ["success", "failure"].includes(input.ci.checkRun.conclusion) &&
        ["allow_release", "block_release"].includes(input.ci.releaseGate.status) &&
        input.pathState.get(input.ci.jsonPath) === true,
      severity: "critical",
      evidence: [
        input.ci.jsonPath,
        input.ci.markdownPath,
        `check=${input.ci.checkRun.conclusion}`,
        `release=${input.ci.releaseGate.status}`,
        `gateEvent=${input.ci.gate.event.eventId}`
      ],
      missing: missingPaths(input.pathState, [
        input.ci.jsonPath,
        input.ci.markdownPath
      ]),
      nextAction: "runstead startup ci summary --stage launch"
    }),
    criterion({
      id: "operations_resume_audit",
      title: "Operations Resume Audit",
      status: diagnosticsMissing.length === 0,
      severity: "major",
      evidence: [
        input.diagnostics.markdownPath,
        input.diagnostics.jsonPath,
        ...(input.diagnostics.stateBackupPath === undefined
          ? []
          : [input.diagnostics.stateBackupPath]),
        `events=${input.eventCount}`
      ],
      missing: diagnosticsMissing,
      nextAction: "runstead ops diagnostics && runstead resume"
    })
  ];

  return criteria;
}

function startupCompleteProductArtifactCriterion(
  surfaces: StartupCompleteProductSurfaces
): StartupCompleteProductCriterion {
  return criterion({
    id: "artifact_truth",
    title: "Artifact State Evidence Event Truth",
    status:
      surfaces.evidenceId.trim().length > 0 &&
      surfaces.eventId.trim().length > 0 &&
      surfaces.completeCheckMarkdown.trim().length > 0 &&
      surfaces.completeCheckJson.trim().length > 0,
    severity: "critical",
    evidence: [
      surfaces.completeCheckMarkdown,
      surfaces.completeCheckJson,
      surfaces.evidenceId,
      surfaces.eventId
    ],
    missing: [],
    nextAction:
      "use the generated markdown, JSON, evidence, and event as the review source of truth"
  });
}

function criterion(input: {
  id: string;
  title: string;
  status: boolean;
  severity: StartupCompleteProductCriterion["severity"];
  evidence: string[];
  missing: string[];
  nextAction: string;
}): StartupCompleteProductCriterion {
  return {
    id: input.id,
    title: input.title,
    status: input.status ? "passed" : "blocked",
    severity: input.severity,
    evidence: uniqueNonEmpty(input.evidence),
    missing: uniqueNonEmpty(input.missing),
    nextAction: input.nextAction
  };
}

function startupCompleteProductBlockers(input: {
  gate: StartupGateCheckResult;
  launchReport: LaunchReadinessReportResult;
  evidenceRows: EvidenceRow[];
}): StartupCompleteProductBlockerAudit[] {
  return input.launchReport.blockers.map((blocker) => {
    const finding = input.gate.findings.find((item) => item.message === blocker);
    const matchingEvidence = input.evidenceRows.filter((row) =>
      evidenceMatchesBlocker(row, blocker)
    );
    const owner =
      matchingEvidence
        .map((row) => artifactRemediationOwner(readEvidenceArtifact(row.uri)))
        .find((value): value is string => value !== undefined) ?? "founder";

    return {
      blocker,
      severity: finding?.severity ?? "major",
      owner,
      remediationTask:
        finding?.remediationTask ?? "startup gate no longer reports this blocker",
      evidenceSources: uniqueNonEmpty([
        input.gate.event.eventId,
        input.launchReport.reportPath,
        input.launchReport.jsonPath,
        ...matchingEvidence.map((row) => row.id)
      ])
    };
  });
}

function evidenceMatchesBlocker(row: EvidenceRow, blocker: string): boolean {
  const artifact = readEvidenceArtifact(row.uri);
  const summary = row.summary ?? "";

  if (summary.includes(blocker)) {
    return true;
  }

  if (isRecord(artifact?.associations) && artifact.associations.blocker === blocker) {
    return true;
  }

  return false;
}

function artifactRemediationOwner(
  artifact: StartupEvidenceArtifact | undefined
): string | undefined {
  if (!isRecord(artifact?.remediation)) {
    return undefined;
  }

  return typeof artifact.remediation.owner === "string" &&
    artifact.remediation.owner.trim().length > 0
    ? artifact.remediation.owner
    : undefined;
}

function startupCompleteProductJson(input: {
  result: StartupCompleteProductCheckResult;
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): JsonObject {
  return {
    schemaVersion: STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION,
    schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA,
    kind: "startup_complete_product_check",
    generatedAt: input.result.generatedAt,
    markdownPath: input.result.markdownPath,
    data: {
      domain: input.result.domain,
      status: input.result.status,
      score: input.result.score,
      evidenceId: input.result.evidenceId,
      eventId: input.result.event.eventId,
      criteria: input.result.criteria,
      blockers: input.result.blockers,
      surfaces: input.result.surfaces,
      launchReport: {
        status: input.launchReport.status,
        blockers: input.launchReport.blockers,
        trustSummary: input.launchReport.trustSummary,
        markdownPath: input.launchReport.reportPath,
        jsonPath: input.launchReport.jsonPath
      },
      ci: {
        checkRun: input.ci.checkRun,
        releaseGate: input.ci.releaseGate,
        jsonPath: input.ci.jsonPath,
        markdownPath: input.ci.markdownPath
      },
      remediation: {
        status: input.remediation.status,
        blockers: input.remediation.blockers,
        tasks: input.remediation.tasks.map((item) => ({
          taskId: item.task.id,
          blocker: item.blocker,
          severity: item.severity,
          acceptanceCriteria: item.acceptanceCriteria,
          dependsOn: item.dependsOn
        })),
        plan: input.remediation.plan,
        nextCommands: input.remediation.nextCommands
      },
      diagnostics: {
        markdownPath: input.diagnostics.markdownPath,
        jsonPath: input.diagnostics.jsonPath,
        stateBackupPath: input.diagnostics.stateBackupPath,
        doctorOk: input.diagnostics.summary.doctorOk,
        managerLock: input.diagnostics.summary.managerLock,
        retention: input.diagnostics.summary.retention
      }
    }
  } as JsonObject;
}

function startupCompleteProductEvent(input: {
  eventId: string;
  domain: string;
  generatedAt: string;
  status: StartupCompleteProductStatus;
  score: number;
  markdownPath: string;
  jsonPath: string;
  evidenceId: string;
  criteria: StartupCompleteProductCriterion[];
  blockers: StartupCompleteProductBlockerAudit[];
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): RunsteadEvent {
  const payload = {
    domain: input.domain,
    status: input.status,
    score: input.score,
    evidenceId: input.evidenceId,
    uri: pathToFileURL(input.markdownPath).href,
    jsonUri: pathToFileURL(input.jsonPath).href,
    criteria: input.criteria.map((criterion) => ({
      id: criterion.id,
      status: criterion.status,
      severity: criterion.severity
    })),
    blockers: input.blockers,
    surfaces: {
      launchReportMarkdown: input.launchReport.reportPath,
      launchReportJson: input.launchReport.jsonPath,
      ciMarkdown: input.ci.markdownPath,
      ciJson: input.ci.jsonPath,
      diagnosticsMarkdown: input.diagnostics.markdownPath,
      diagnosticsJson: input.diagnostics.jsonPath,
      remediationStatus: input.remediation.status
    }
  } as JsonObject;

  return {
    eventId: input.eventId,
    type: "startup_complete_product.checked",
    aggregateType: "startup_complete_product",
    aggregateId: input.domain,
    payload: {
      ...payload,
      hash: sha256(JSON.stringify(payload))
    },
    createdAt: input.generatedAt
  };
}

function readStartupEvidenceRows(stateDb: string): EvidenceRow[] {
  const database = openRunsteadDatabase(stateDb);

  try {
    return database
      .prepare(
        `
        SELECT id, type, uri, summary, created_at
        FROM evidence
        WHERE type = 'command_output' OR type LIKE 'startup_%'
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as EvidenceRow[];
  } finally {
    database.close();
  }
}

function readEventCount(stateDb: string): number {
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM events")
      .get() as unknown as EventCountRow;

    return row.count;
  } finally {
    database.close();
  }
}

async function existingPathState(paths: string[]): Promise<Map<string, boolean>> {
  const results = await Promise.all(
    paths.map(async (path) => [path, await pathExists(path)] as const)
  );

  return new Map(results);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);

    return result.isFile();
  } catch {
    return false;
  }
}

function missingPaths(pathState: Map<string, boolean>, paths: string[]): string[] {
  return paths.filter((path) => pathState.get(path) !== true);
}

function readEvidenceArtifact(uri: string): StartupEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function completeProductStatus(
  criteria: StartupCompleteProductCriterion[]
): StartupCompleteProductStatus {
  return criteria.every((criterion) => criterion.status === "passed")
    ? "complete"
    : "incomplete";
}

function completeProductScore(criteria: StartupCompleteProductCriterion[]): number {
  if (criteria.length === 0) {
    return 0;
  }

  return (
    Math.round(
      (criteria.filter((criterion) => criterion.status === "passed").length /
        criteria.length) *
        100
    ) / 100
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
