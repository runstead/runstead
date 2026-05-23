import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  collectRepoInspection,
  type RepoInspectionSnapshot
} from "./inspection-evidence.js";
import { matchesPolicyPathPattern } from "./policy.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  listStartupArtifacts,
  type StartupArtifactListItem
} from "./startup-artifacts.js";
import { checkStartupGate } from "./startup-evidence.js";
import {
  collectCommandVerifierCodeState,
  type CommandVerifierCodeState
} from "./verifier-evidence.js";

const execFileAsync = promisify(execFile);

export interface GenerateLaunchReadinessReportOptions {
  cwd?: string;
  domain?: string;
  now?: Date;
}

export interface LaunchReadinessReportResult {
  root: string;
  stateDb: string;
  domain: string;
  reportPath: string;
  jsonPath: string;
  markdown: string;
  event: RunsteadEvent;
  status: LaunchReadinessStatus;
  blockers: string[];
  trustSummary: LaunchReadinessTrustSummary;
}

type LaunchReadinessStatus = "launch_ready" | "blocked";

export interface LaunchReadinessTrustSummary {
  qualityScore: number;
  evidenceCompletenessScore: number;
  conclusion: string;
  remediationEffort: string;
  acceptedDebtRegister: string[];
  trend: {
    previousStatus?: string;
    previousBlockers?: number;
    blockerDelta: number;
    addedBlockers: string[];
    resolvedBlockers: string[];
  };
  auditExport: {
    schemaVersion: 1;
    evidenceRecords: number;
    structuredArtifacts: number;
  };
}

interface GoalReportRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

interface TaskReportRow {
  id: string;
  goal_id: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  output_json: string | null;
  updated_at: string;
}

interface EvidenceReportRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  task_domain: string | null;
  task_type: string | null;
  task_input_json: string | null;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface PolicyDecisionReportRow {
  id: string;
  action_id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
  created_at: string;
}

interface ApprovalReportRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

interface PreviousLaunchReadinessReport {
  eventId: string;
  status?: string;
  blockers: string[];
}

interface EvidenceProvenanceArtifact {
  sources?: unknown;
  provenance?: unknown;
  codeState?: unknown;
}

interface LaunchReadinessReportData {
  repo: RepoInspectionSnapshot;
  protectedPathChanges: string[];
  gate: {
    blockers: string[];
    warnings: string[];
  };
  goals: GoalReportRow[];
  tasks: TaskReportRow[];
  evidence: EvidenceReportRow[];
  policyDecisions: PolicyDecisionReportRow[];
  approvals: ApprovalReportRow[];
  structuredArtifacts: StartupArtifactListItem[];
  currentCodeState: CommandVerifierCodeState;
}

const STARTUP_DOMAIN = "ai-native-startup";
const PROTECTED_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "**/secrets/**",
  "infra/prod/**",
  "billing/**",
  "compliance/**"
];

export async function generateLaunchReadinessReport(
  options: GenerateLaunchReadinessReportOptions = {}
): Promise<LaunchReadinessReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const data: LaunchReadinessReportData = {
      repo: await collectRepoInspection(cwd, generatedAt),
      protectedPathChanges: await changedProtectedPaths(cwd),
      gate: await launchGateEvaluation({
        cwd,
        domain,
        ...(options.now === undefined ? {} : { now: options.now })
      }),
      structuredArtifacts: (await listStartupArtifacts({ cwd })).artifacts,
      currentCodeState: await collectCommandVerifierCodeState(cwd),
      ...readLaunchReadinessData(database, domain)
    };
    const blockers = releaseBlockers(data);
    const status: LaunchReadinessStatus =
      blockers.length === 0 ? "launch_ready" : "blocked";
    const aggregateId = `launch_readiness_${domain.replaceAll("-", "_")}`;
    const previousReport = readPreviousLaunchReadinessEvent(database, aggregateId);
    const trustSummary = launchReadinessTrustSummary({
      status,
      blockers,
      data,
      ...(previousReport === undefined ? {} : { previousReport })
    });
    const markdown = formatLaunchReadinessReport({
      generatedAt,
      domain,
      status,
      blockers,
      trustSummary,
      data
    });
    const reportPath = join(
      resolvedState.root,
      "reports",
      `launch-readiness-${domain}.md`
    );
    const jsonPath = join(
      resolvedState.root,
      "reports",
      `launch-readiness-${domain}.json`
    );
    const auditExport = {
      schemaVersion: 1,
      generatedAt,
      domain,
      status,
      blockers,
      trustSummary,
      evidence: data.evidence.map((item) => ({
        id: item.id,
        type: item.type,
        summary: item.summary,
        uri: item.uri,
        createdAt: item.created_at
      })),
      structuredArtifacts: data.structuredArtifacts.map((item) => ({
        id: item.id,
        kind: item.kind,
        path: item.path,
        sourceEvidenceIds: item.sourceEvidenceIds
      }))
    };
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "report.generated",
      aggregateType: "report",
      aggregateId,
      payload: reportEventPayload({
        domain,
        status,
        blockers,
        reportPath,
        jsonPath,
        markdown,
        trustSummary,
        data
      }),
      createdAt: generatedAt
    };

    await mkdir(join(resolvedState.root, "reports"), { recursive: true });
    await writeFile(reportPath, markdown, "utf8");
    await writeFile(jsonPath, `${JSON.stringify(auditExport, null, 2)}\n`, "utf8");
    appendEventAndProject(database, { event });

    return {
      root: resolvedState.root,
      stateDb,
      domain,
      reportPath,
      jsonPath,
      markdown,
      event,
      status,
      blockers,
      trustSummary
    };
  } finally {
    database.close();
  }
}

async function launchGateEvaluation(input: {
  cwd: string;
  domain: string;
  now?: Date;
}): Promise<{ blockers: string[]; warnings: string[] }> {
  const result = await checkStartupGate({
    cwd: input.cwd,
    domain: input.domain,
    stage: "launch",
    ...(input.now === undefined ? {} : { now: input.now }),
    recordEvent: false
  });

  return {
    blockers: result.blockers,
    warnings: result.warnings
  };
}

function readLaunchReadinessData(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string
): Omit<
  LaunchReadinessReportData,
  "repo" | "protectedPathChanges" | "gate" | "structuredArtifacts" | "currentCodeState"
> {
  const goals = database
    .prepare(
      `
      SELECT id, title, status, priority, created_at, updated_at
      FROM goals
      WHERE domain = ?
      ORDER BY status ASC, priority DESC, created_at DESC, id ASC
    `
    )
    .all(domain) as unknown as GoalReportRow[];
  const tasks = database
    .prepare(
      `
      SELECT id, goal_id, type, status, priority, attempt, max_attempts,
             output_json, updated_at
      FROM tasks
      WHERE domain = ?
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(domain) as unknown as TaskReportRow[];
  const evidence = database
    .prepare(
      `
      SELECT DISTINCT e.id, e.type, e.subject_type, e.subject_id,
             t.domain AS task_domain, t.type AS task_type,
             t.input_json AS task_input_json,
             e.uri, e.summary, e.created_at
      FROM evidence e
      LEFT JOIN tasks t ON e.subject_type = 'task' AND e.subject_id = t.id
      WHERE t.domain = ?
         OR e.type = 'repo_inspection'
         OR e.type = 'command_output'
         OR e.type LIKE 'startup_%'
      ORDER BY e.created_at DESC, e.id ASC
    `
    )
    .all(domain) as unknown as EvidenceReportRow[];
  const policyDecisions = database
    .prepare(
      `
      SELECT id, action_id, decision, risk, rule_id, reason, created_at
      FROM policy_decisions
      ORDER BY created_at DESC, id ASC
      LIMIT 25
    `
    )
    .all() as unknown as PolicyDecisionReportRow[];
  const approvals = database
    .prepare(
      `
      SELECT id, action_id, status, risk, reason, updated_at
      FROM approvals
      ORDER BY updated_at DESC, id ASC
      LIMIT 25
    `
    )
    .all() as unknown as ApprovalReportRow[];

  return {
    goals,
    tasks,
    evidence,
    policyDecisions,
    approvals
  };
}

function formatLaunchReadinessReport(input: {
  generatedAt: string;
  domain: string;
  status: LaunchReadinessStatus;
  blockers: string[];
  trustSummary: LaunchReadinessTrustSummary;
  data: LaunchReadinessReportData;
}): string {
  return [
    "# Runstead Launch Readiness Report",
    "",
    `Domain: ${input.domain}`,
    `Generated: ${input.generatedAt}`,
    `Status: ${input.status}`,
    "",
    "## Trust Summary",
    "",
    trustSummaryMarkdown(input.trustSummary),
    "",
    "## Metric Evidence Confidence",
    "",
    metricEvidenceConfidence(input.data),
    "",
    "## Repo Health",
    "",
    repoHealth(input.data.repo),
    "",
    "## Verifier Status",
    "",
    verifierStatus(input.data),
    "",
    "## Governance Boundary",
    "",
    governanceBoundary(input.data),
    "",
    "## Test Coverage Gaps",
    "",
    testCoverageGaps(input.data),
    "",
    "## Dependency And Security Risk",
    "",
    dependencyAndSecurityRisk(input.data),
    "",
    "## Protected Path Changes",
    "",
    listOrNone(input.data.protectedPathChanges, (path) => `- ${path}`),
    "",
    "## Architectural Debt",
    "",
    architecturalDebt(input.data),
    "",
    "## Missing Observability",
    "",
    missingObservability(input.data),
    "",
    "## Frontend UI Validation",
    "",
    frontendUiValidation(input.data),
    "",
    "## Structured Startup Artifacts",
    "",
    structuredStartupArtifacts(input.data),
    "",
    "## Evidence Provenance",
    "",
    evidenceProvenance(input.data),
    "",
    "## Stale Evidence Appendix",
    "",
    staleEvidenceAppendix(input.data),
    "",
    "## Release Blockers",
    "",
    listOrNone(
      input.blockers,
      (blocker) => `- ${blocker} [source: ${blockerSource(input.data, blocker)}]`
    ),
    "",
    "## Risk Register",
    "",
    riskRegister(input.data, input.blockers),
    "",
    "## Acceptable Debt",
    "",
    acceptableDebt(input.data),
    "",
    "## Next Sprint Remediation Plan",
    "",
    nextSprintPlan(input.blockers),
    ""
  ].join("\n");
}

function repoHealth(repo: RepoInspectionSnapshot): string {
  const packageManager = repo.packageManager.detected
    ? `${repo.packageManager.packageManager} (${repo.packageManager.source})`
    : "not detected";
  const testCommand = repo.commands.test.detected
    ? repo.commands.test.command
    : "missing";
  const lintCommand = repo.commands.lint.detected
    ? repo.commands.lint.command
    : "missing";
  const typecheckCommand = repo.commands.typecheck.detected
    ? repo.commands.typecheck.command
    : "missing";
  const buildCommand = repo.commands.build.detected
    ? repo.commands.build.command
    : "missing";
  const ci = repo.ci.detected
    ? repo.ci.providers.map((provider) => provider.provider).join(", ")
    : "missing";

  return [
    `- Git: ${repo.git.isGitRepo ? "detected" : "not detected"}`,
    `- Branch: ${repo.git.branch ?? "unknown"}`,
    `- Package manager: ${packageManager}`,
    `- Test command: ${testCommand}`,
    `- Lint command: ${lintCommand}`,
    `- Typecheck command: ${typecheckCommand}`,
    `- Build command: ${buildCommand}`,
    `- CI: ${ci}`
  ].join("\n");
}

function trustSummaryMarkdown(summary: LaunchReadinessTrustSummary): string {
  return [
    `- Quality score: ${formatPercent(summary.qualityScore)}`,
    `- Evidence completeness: ${formatPercent(summary.evidenceCompletenessScore)}`,
    `- Conclusion: ${summary.conclusion}`,
    `- Remediation effort: ${summary.remediationEffort}`,
    `- Trend: blocker_delta=${summary.trend.blockerDelta}, previous_status=${summary.trend.previousStatus ?? "none"}`,
    "- Accepted debt register:",
    indentList(summary.acceptedDebtRegister),
    "- Audit export:",
    `  - schemaVersion=${summary.auditExport.schemaVersion}`,
    `  - evidenceRecords=${summary.auditExport.evidenceRecords}`,
    `  - structuredArtifacts=${summary.auditExport.structuredArtifacts}`
  ].join("\n");
}

function metricEvidenceConfidence(data: LaunchReadinessReportData): string {
  const metricEvidence = data.evidence.filter(
    (item) => item.type === "startup_metric_snapshot"
  );

  return listOrNone(metricEvidence, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: source_class=missing confidence=unknown launch_weight=unknown`;
    }

    const sourceClass = stringValue(content.sourceClass) ?? "founder_manual";
    const confidence =
      typeof content.confidence === "number"
        ? formatScore(content.confidence)
        : "unknown";
    const launchWeight =
      typeof content.launchWeight === "number"
        ? formatScore(content.launchWeight)
        : "unknown";
    const realUserData =
      typeof content.realUserData === "boolean"
        ? content.realUserData
          ? "yes"
          : "no"
        : "unknown";

    return [
      `- ${item.id}: metric=${stringValue(content.metric) ?? "unknown"}`,
      `source_class=${sourceClass}`,
      `confidence=${confidence}`,
      `launch_weight=${launchWeight}`,
      `real_user_data=${realUserData}`
    ].join(" ");
  });
}

function launchReadinessTrustSummary(input: {
  status: LaunchReadinessStatus;
  blockers: string[];
  data: LaunchReadinessReportData;
  previousReport?: PreviousLaunchReadinessReport;
}): LaunchReadinessTrustSummary {
  const requiredEvidenceTypes = [
    "command_output",
    "startup_measurement_framework",
    "startup_metric_snapshot",
    "startup_repo_readiness",
    "startup_security_baseline",
    "startup_migration_plan",
    "startup_rollback_plan",
    "startup_observability",
    "startup_founder_bottleneck"
  ];
  const completedEvidence = requiredEvidenceTypes.filter((type) =>
    hasEvidenceType(input.data.evidence, type)
  );
  const evidenceCompletenessScore =
    completedEvidence.length / requiredEvidenceTypes.length;
  const hasProvenance = input.data.evidence.some(
    (item) => artifactSources(readEvidenceProvenanceArtifact(item.uri)).length > 0
  );
  const qualityScore = clampScore(
    evidenceCompletenessScore * 0.7 +
      (input.data.structuredArtifacts.length > 0 ? 0.1 : 0) +
      (hasProvenance ? 0.1 : 0) +
      (input.status === "launch_ready" ? 0.1 : 0) -
      Math.min(input.blockers.length * 0.06, 0.5)
  );
  const previousBlockers = input.previousReport?.blockers ?? [];
  const currentBlockers = input.blockers;
  const acceptedDebtRegister = acceptedDebtRegisterRows(input.data);

  return {
    qualityScore,
    evidenceCompletenessScore,
    conclusion:
      input.status === "launch_ready"
        ? "Launch-ready: required gate, verifier, readiness, security, and operational evidence are present."
        : `Not launch-ready: ${input.blockers.length} blocker${input.blockers.length === 1 ? "" : "s"} remain; top blocker is ${input.blockers[0] ?? "unknown"}.`,
    remediationEffort: remediationEffort(input.blockers),
    acceptedDebtRegister,
    trend: {
      ...(input.previousReport?.status === undefined
        ? {}
        : { previousStatus: input.previousReport.status }),
      ...(input.previousReport === undefined
        ? {}
        : { previousBlockers: previousBlockers.length }),
      blockerDelta: currentBlockers.length - previousBlockers.length,
      addedBlockers: currentBlockers.filter(
        (blocker) => !previousBlockers.includes(blocker)
      ),
      resolvedBlockers: previousBlockers.filter(
        (blocker) => !currentBlockers.includes(blocker)
      )
    },
    auditExport: {
      schemaVersion: 1,
      evidenceRecords: input.data.evidence.length,
      structuredArtifacts: input.data.structuredArtifacts.length
    }
  };
}

function acceptedDebtRegisterRows(data: LaunchReadinessReportData): string[] {
  const debtEvidence = data.evidence.filter(
    (item) =>
      item.type === "startup_acceptable_debt" || item.type === "startup_decision"
  );
  const rows = debtEvidence.flatMap((item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return item.type === "startup_acceptable_debt"
        ? [`${item.id}: ${item.summary ?? "accepted debt"} owner=unknown`]
        : [];
    }

    if (
      item.type !== "startup_acceptable_debt" &&
      content.decision !== "launch_with_accepted_debt"
    ) {
      return [];
    }

    return [
      `${item.id}: ${stringValue(content.reason) ?? item.summary ?? "accepted debt"} owner=${stringValue(content.owner) ?? "unknown"} expires=${stringValue(content.expiresAt) ?? "none"}`
    ];
  });

  return rows.length === 0 ? ["none recorded"] : rows;
}

function remediationEffort(blockers: string[]): string {
  if (blockers.length === 0) {
    return "low: keep gates green and rerun before release";
  }

  if (blockers.length <= 2) {
    return "medium: one focused remediation loop should be enough";
  }

  if (blockers.length <= 5) {
    return "high: split remediation into verifier, evidence, and governance tracks";
  }

  return "very high: defer launch and run a full remediation plan";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return String(clampScore(value));
}

function indentList(items: string[]): string {
  return items.map((item) => `  - ${item}`).join("\n");
}

function verifierStatus(data: LaunchReadinessReportData): string {
  const verifierTasks = data.tasks.filter(
    (task) => task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers"
  );
  const commandEvidence = currentCommandEvidence(data);
  const staleEvidence = staleCommandEvidence(data);

  return [
    `- Verifier tasks: ${formatTaskCounts(verifierTasks)}`,
    `- Current code fingerprint: ${formatCurrentCodeFingerprint(data.currentCodeState)}`,
    `- Current command evidence records: ${commandEvidence.length}`,
    `- Stale command evidence records: ${staleEvidence.length} (see appendix)`,
    ...commandEvidence.map(
      (item) =>
        `- ${item.id}: ${item.summary ?? item.uri} (${item.created_at}; ${commandEvidenceGovernance(item)}; ${commandEvidenceCodeState(data, item)})`
    )
  ].join("\n");
}

function currentCommandEvidence(data: LaunchReadinessReportData): EvidenceReportRow[] {
  return data.evidence
    .filter((item) => item.type === "command_output")
    .filter((item) => !isStaleCommandEvidence(data, item));
}

function staleCommandEvidence(data: LaunchReadinessReportData): EvidenceReportRow[] {
  return data.evidence
    .filter((item) => item.type === "command_output")
    .filter((item) => isStaleCommandEvidence(data, item));
}

function isStaleCommandEvidence(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): boolean {
  return commandEvidenceCodeState(data, item).startsWith("code_state=stale");
}

function governanceBoundary(data: LaunchReadinessReportData): string {
  const commandEvidence = currentCommandEvidence(data);

  return [
    "- Governance level: Level 1 wrapped execution for external workers; `codex_direct` is the hard-proxy path.",
    "- `codex_cli` and `claude_code` runs are policy-gated before launch, checkpointed, scope-verified after exit, and validated through verifier evidence.",
    "- Worker-internal tool calls from wrapped workers are not fully hard-proxied by Runstead.",
    "- Recommendation: use `codex_cli` for ecosystem compatibility; use `codex_direct` when every model tool call must pass through Runstead policy and audit.",
    ...(commandEvidence.length === 0
      ? ["- Command evidence governance: none recorded."]
      : [
          "- Command evidence governance:",
          ...commandEvidence.map(
            (item) => `  - ${item.id}: ${commandEvidenceGovernance(item)}`
          )
        ])
  ].join("\n");
}

function commandEvidenceGovernance(item: EvidenceReportRow): string {
  if (item.task_type === "local_agent_task") {
    const worker = taskInputWorker(item.task_input_json);

    if (worker === "codex_direct") {
      return "codex_direct governed verifier evidence";
    }

    if (worker === "codex_cli" || worker === "claude_code") {
      return "wrapped worker post-run verifier evidence";
    }

    return "local agent post-run verifier evidence";
  }

  if (
    item.task_type === "run_mvp_verifiers" ||
    item.task_type === "run_local_verifiers"
  ) {
    return "Runstead verifier task evidence";
  }

  return "command verifier evidence";
}

function taskInputWorker(inputJson: string | null): string | undefined {
  if (inputJson === null) {
    return undefined;
  }

  try {
    const input = JSON.parse(inputJson) as unknown;

    return isRecord(input) && typeof input.worker === "string"
      ? input.worker
      : undefined;
  } catch {
    return undefined;
  }
}

function formatCurrentCodeFingerprint(codeState: CommandVerifierCodeState): string {
  return codeState.available
    ? `${codeState.fingerprint}${codeState.dirty ? " dirty" : " clean"}`
    : "unavailable";
}

function commandEvidenceCodeState(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const codeState = isRecord(artifact?.codeState) ? artifact.codeState : undefined;
  const fingerprint =
    codeState === undefined ? undefined : stringValue(codeState.fingerprint);

  if (fingerprint === undefined) {
    return "code_state=missing";
  }

  return fingerprint === data.currentCodeState.fingerprint
    ? "code_state=current"
    : `code_state=stale current=${data.currentCodeState.fingerprint}`;
}

function testCoverageGaps(data: LaunchReadinessReportData): string {
  const gaps = [
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...staleCommandEvidenceGaps(data),
    ...data.gate.warnings
  ];

  return listOrNone(gaps, (gap) => `- ${gap}`);
}

function staleCommandEvidenceGaps(data: LaunchReadinessReportData): string[] {
  const stale = staleCommandEvidence(data);

  return stale.length === 0
    ? []
    : [
        `${stale.length} verifier evidence record${stale.length === 1 ? "" : "s"} recorded against stale code state; see stale evidence appendix`
      ];
}

function dependencyAndSecurityRisk(data: LaunchReadinessReportData): string {
  const pendingApprovals = data.approvals.filter(
    (approval) => approval.status === "pending"
  );
  const highRiskDecisions = data.policyDecisions.filter(
    (decision) => decision.risk === "high" || decision.risk === "critical"
  );
  const risks = [
    ...(data.protectedPathChanges.length === 0
      ? []
      : [`protected path changes: ${data.protectedPathChanges.join(", ")}`]),
    ...(pendingApprovals.length === 0
      ? []
      : [`pending approvals: ${pendingApprovals.map((item) => item.id).join(", ")}`]),
    ...(highRiskDecisions.length === 0
      ? []
      : [
          `recent high-risk policy decisions: ${highRiskDecisions
            .map((item) => item.id)
            .join(", ")}`
        ])
  ];

  return listOrNone(risks, (risk) => `- ${risk}`);
}

function architecturalDebt(data: LaunchReadinessReportData): string {
  const debtEvidence = data.evidence.filter(
    (item) => item.type === "startup_accepted_debt" || item.type === "startup_debt"
  );

  if (debtEvidence.length === 0) {
    return "- no accepted debt evidence recorded";
  }

  return debtEvidence
    .map((item) => `- ${item.id}: ${item.summary ?? item.uri}`)
    .join("\n");
}

function missingObservability(data: LaunchReadinessReportData): string {
  const measurementPresent =
    hasEvidenceType(data.evidence, "startup_measurement_framework") ||
    hasCompletedTask(data.tasks, "define_measurement_framework");
  const metricPresent =
    hasEvidenceType(data.evidence, "startup_metric") ||
    hasEvidenceType(data.evidence, "startup_observability");
  const rows = [
    measurementPresent
      ? "measurement framework evidence present"
      : "measurement framework evidence is missing",
    metricPresent
      ? "metric or observability evidence present"
      : "metric or observability evidence is missing"
  ];

  return rows.map((row) => `- ${row}`).join("\n");
}

function frontendUiValidation(data: LaunchReadinessReportData): string {
  const rows = data.evidence.filter((item) => item.type === "startup_ui_validation");

  return listOrNone(rows, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: ${item.summary ?? item.uri}`;
    }

    return [
      `- ${item.id}: url=${stringValue(content.url) ?? "unknown"}`,
      `viewport=${stringValue(content.viewport) ?? "unknown"}`,
      `dom=${stringValue(content.domStatus) ?? "unknown"}`,
      `accessibility=${stringValue(content.accessibilityStatus) ?? "unknown"}`,
      `responsive=${stringValue(content.responsiveStatus) ?? "unknown"}`,
      `flow=${stringValue(content.criticalFlowStatus) ?? "unknown"}`
    ].join(" ");
  });
}

function parsedEvidenceContent(uri: string): unknown {
  const artifact = readEvidenceProvenanceArtifact(uri);

  if (!isRecord(artifact) || typeof artifact.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

function structuredStartupArtifacts(data: LaunchReadinessReportData): string {
  return listOrNone(
    data.structuredArtifacts,
    (item) =>
      `- ${item.kind}: ${item.id} (schemaVersion=${item.schemaVersion}, evidenceRefs=${item.sourceEvidenceIds.length})`
  );
}

function evidenceProvenance(data: LaunchReadinessReportData): string {
  const rows = data.evidence.filter(
    (item) =>
      (item.type === "command_output" && !isStaleCommandEvidence(data, item)) ||
      item.type.startsWith("startup_")
  );

  return listOrNone(rows, (item) => `- ${item.id}: ${evidenceSourceSummary(item)}`);
}

function staleEvidenceAppendix(data: LaunchReadinessReportData): string {
  const rows = staleCommandEvidence(data);

  return listOrNone(
    rows,
    (item) =>
      `- ${item.id}: ${item.summary ?? item.uri} (${commandEvidenceCodeState(data, item)}; ${commandEvidenceGovernance(item)}; ${evidenceSourceSummary(item)})`
  );
}

function evidenceSourceSummary(item: EvidenceReportRow): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const sources = artifactSources(artifact);

  if (sources.length === 0) {
    return `${item.type} artifact=${item.uri}`;
  }

  return `${item.type} ${sources.map(formatArtifactSource).join("; ")}`;
}

function readEvidenceProvenanceArtifact(
  uri: string
): EvidenceProvenanceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function artifactSources(
  artifact: EvidenceProvenanceArtifact | undefined
): JsonObject[] {
  if (artifact === undefined || !Array.isArray(artifact.sources)) {
    return [];
  }

  return artifact.sources.filter((source): source is JsonObject => isRecord(source));
}

function formatArtifactSource(source: JsonObject): string {
  const kind = stringValue(source.kind) ?? "unknown";
  const uri = stringValue(source.uri) ?? "missing";
  const capturedAt = stringValue(source.capturedAt) ?? "unknown";
  const freshness =
    typeof source.freshnessDays === "number"
      ? ` freshness=${source.freshnessDays}d`
      : "";
  const hash = stringValue(source.hash);

  return `source=${kind} uri=${uri} captured=${capturedAt}${freshness}${hash === undefined ? "" : ` hash=${hash}`}`;
}

function acceptableDebt(data: LaunchReadinessReportData): string {
  const acceptableDebtEvidence = data.evidence.filter(
    (item) => item.type === "startup_acceptable_debt"
  );

  return listOrNone(
    acceptableDebtEvidence,
    (item) => `- ${item.id}: ${item.summary ?? item.uri}`
  );
}

function nextSprintPlan(blockers: string[]): string {
  if (blockers.length === 0) {
    return "- keep launch gates green and rerun readiness before release";
  }

  return blockers
    .slice(0, 5)
    .map((blocker) => `- remediate: ${blocker}`)
    .join("\n");
}

function riskRegister(data: LaunchReadinessReportData, blockers: string[]): string {
  const rows = [
    ...blockers.map((blocker) => ({
      risk: blocker,
      source: riskSource(data, blocker),
      recommendedTask: recommendedTaskForRisk(blocker)
    })),
    ...missingEvidenceRows(data)
  ];

  if (rows.length === 0) {
    return "- no launch risks detected";
  }

  return rows
    .map(
      (row) =>
        `- Risk: ${row.risk}\n  Source: ${row.source}\n  Recommended task: ${row.recommendedTask}`
    )
    .join("\n");
}

function missingEvidenceRows(data: LaunchReadinessReportData): {
  risk: string;
  source: string;
  recommendedTask: string;
}[] {
  return [
    ...(hasEvidenceType(data.evidence, "startup_repo_readiness")
      ? []
      : [
          {
            risk: "repo readiness evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch audit"
          }
        ]),
    ...(hasEvidenceType(data.evidence, "startup_security_baseline")
      ? []
      : [
          {
            risk: "security baseline evidence is not recorded",
            source: "evidence ledger",
            recommendedTask: "run startup launch security-baseline"
          }
        ])
  ];
}

function riskSource(data: LaunchReadinessReportData, risk: string): string {
  if (risk.startsWith("task ")) return blockerSource(data, risk);
  if (risk.includes("test command")) return "package.json scripts";
  if (risk.includes("lint command")) return "package.json scripts";
  if (risk.includes("typecheck command")) return "package.json scripts";
  if (risk.includes("build command")) return "package.json scripts";
  if (risk.includes("CI configuration")) return "repo inspection";
  if (risk.includes("verifier")) return evidenceSource(data, "command_output");
  if (risk.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (risk.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (risk.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (risk.includes("migration")) return evidenceSource(data, "startup_migration_plan");
  if (risk.includes("rollback")) return evidenceSource(data, "startup_rollback_plan");
  if (risk.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (risk.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }
  if (risk.includes("protected path")) return "git status protected path scan";
  if (risk.includes("approval")) return "approval ledger";

  return "launch readiness analysis";
}

function blockerSource(data: LaunchReadinessReportData, blocker: string): string {
  const taskMatch = /^task (?<id>\S+) \((?<type>[^)]+)\) is (?<status>\S+)/.exec(
    blocker
  );

  if (taskMatch?.groups !== undefined) {
    return `task:${taskMatch.groups.id} type=${taskMatch.groups.type} status=${taskMatch.groups.status}`;
  }

  if (blocker.startsWith("approval ")) {
    const approvalId = blocker.split(/\s+/)[1] ?? "unknown";

    return `approval:${approvalId}`;
  }

  if (data.gate.blockers.includes(blocker)) {
    return "phase:launch gate=startup_evidence";
  }

  if (blocker.includes("test command")) return "repo:package_json script=test";
  if (blocker.includes("lint command")) return "repo:package_json script=lint";
  if (blocker.includes("typecheck command")) {
    return "repo:package_json script=typecheck";
  }
  if (blocker.includes("build command")) return "repo:package_json script=build";
  if (blocker.includes("CI configuration")) return "repo:ci_detection";
  if (blocker.includes("protected path")) return "repo:git_status protected_path_scan";
  if (blocker.includes("verifier")) return evidenceSource(data, "command_output");
  if (blocker.includes("measurement")) {
    return evidenceSource(data, "startup_measurement_framework");
  }
  if (blocker.includes("repo readiness")) {
    return evidenceSource(data, "startup_repo_readiness");
  }
  if (blocker.includes("security baseline")) {
    return evidenceSource(data, "startup_security_baseline");
  }
  if (blocker.includes("migration")) return evidenceSource(data, "startup_migration_plan");
  if (blocker.includes("rollback")) return evidenceSource(data, "startup_rollback_plan");
  if (blocker.includes("observability")) {
    return evidenceSource(data, "startup_observability");
  }
  if (blocker.includes("founder bottleneck")) {
    return evidenceSource(data, "startup_founder_bottleneck");
  }

  return "report:launch_readiness_analysis";
}

function evidenceSource(data: LaunchReadinessReportData, type: string): string {
  const evidence =
    type === "command_output"
      ? currentCommandEvidence(data)[0] ?? staleCommandEvidence(data)[0]
      : data.evidence.find((item) => item.type === type);

  return evidence === undefined ? "missing evidence" : `${evidence.id} ${evidence.uri}`;
}

function recommendedTaskForRisk(risk: string): string {
  if (risk.includes("test command")) return "add or configure a test script";
  if (risk.includes("lint command")) return "add or configure a lint script";
  if (risk.includes("typecheck command")) return "add or configure a typecheck script";
  if (risk.includes("build command")) return "add or configure a build script";
  if (risk.includes("CI configuration")) return "add CI for launch verifier commands";
  if (risk.includes("MVP verifier") || risk.includes("verifier command")) {
    return "run and record MVP verifier evidence";
  }
  if (risk.includes("measurement")) {
    return "run startup measurement generate and attach metric evidence";
  }
  if (risk.includes("repo readiness")) return "run startup launch audit";
  if (risk.includes("security baseline")) {
    return "run startup launch security-baseline";
  }
  if (risk.includes("migration")) return "record startup_migration_plan evidence";
  if (risk.includes("rollback")) return "record startup_rollback_plan evidence";
  if (risk.includes("observability")) return "record startup_observability evidence";
  if (risk.includes("founder bottleneck")) {
    return "run startup launch bottleneck-map";
  }
  if (risk.includes("protected path"))
    return "create review evidence for protected paths";
  if (risk.includes("approval")) return "resolve pending approval before launch";

  return "create a remediation task and attach evidence";
}

function releaseBlockers(data: LaunchReadinessReportData): string[] {
  const hasVerifierEvidence = hasEvidenceType(data.evidence, "command_output");

  return [
    ...data.gate.blockers,
    ...(data.goals.length === 0 ? ["no startup goal exists"] : []),
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...(data.repo.ci.detected ? [] : ["CI configuration is missing"]),
    ...(data.protectedPathChanges.length === 0
      ? []
      : [
          `protected path changes require review: ${data.protectedPathChanges.join(", ")}`
        ]),
    ...unresolvedTaskBlockers({
      ...data,
      hasVerifierEvidence
    }),
    ...data.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => `approval ${approval.id} is pending`)
  ];
}

function unresolvedTaskBlockers(
  data: LaunchReadinessReportData & { hasVerifierEvidence: boolean }
): string[] {
  return latestTaskPerType(scopedTaskBlockerTasks(data))
    .filter((task) => ["failed", "blocked", "waiting_approval"].includes(task.status))
    .filter((task) => !taskBlockerResolvedByEvidence(task, data))
    .map((task) => `task ${task.id} (${task.type}) is ${task.status}`);
}

function scopedTaskBlockerTasks(data: LaunchReadinessReportData): TaskReportRow[] {
  const latestGoal = data.goals
    .toSorted(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
        right.id.localeCompare(left.id)
    )
    .at(0);

  return latestGoal === undefined
    ? data.tasks
    : data.tasks.filter((task) => task.goal_id === latestGoal.id);
}

function latestTaskPerType(tasks: TaskReportRow[]): TaskReportRow[] {
  const latest = new Map<string, TaskReportRow>();

  for (const task of tasks) {
    const current = latest.get(task.type);

    if (
      current === undefined ||
      Date.parse(task.updated_at) > Date.parse(current.updated_at) ||
      (task.updated_at === current.updated_at && task.id.localeCompare(current.id) > 0)
    ) {
      latest.set(task.type, task);
    }
  }

  return [...latest.values()];
}

function taskBlockerResolvedByEvidence(
  task: TaskReportRow,
  data: LaunchReadinessReportData & { hasVerifierEvidence: boolean }
): boolean {
  if (
    data.hasVerifierEvidence &&
    (task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers")
  ) {
    return true;
  }

  if (
    task.type === "generate_agent_context" &&
    hasEvidenceType(data.evidence, "startup_agent_context")
  ) {
    return true;
  }

  if (
    task.type === "define_measurement_framework" &&
    hasEvidenceType(data.evidence, "startup_measurement_framework")
  ) {
    return true;
  }

  if (
    task.type === "inspect_repo_readiness" &&
    hasEvidenceType(data.evidence, "startup_repo_readiness")
  ) {
    return true;
  }

  if (task.type === "startup_remediation" && data.gate.blockers.length === 0) {
    return true;
  }

  return false;
}

function formatTaskCounts(tasks: TaskReportRow[]): string {
  if (tasks.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();

  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function hasCompletedTask(tasks: TaskReportRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

function hasEvidenceType(evidence: EvidenceReportRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
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

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readPreviousLaunchReadinessEvent(
  database: ReturnType<typeof openRunsteadDatabase>,
  aggregateId: string
): PreviousLaunchReadinessReport | undefined {
  const row = database
    .prepare(
      `
      SELECT event_id, payload_json
      FROM events
      WHERE type = 'report.generated'
        AND aggregate_id = ?
      ORDER BY created_at DESC, event_id DESC
      LIMIT 1
    `
    )
    .get(aggregateId) as { event_id: string; payload_json: string } | undefined;

  if (row === undefined) {
    return undefined;
  }

  try {
    const payload = JSON.parse(row.payload_json) as unknown;

    if (!isRecord(payload)) {
      return {
        eventId: row.event_id,
        blockers: []
      };
    }

    return {
      eventId: row.event_id,
      ...(typeof payload.status === "string" ? { status: payload.status } : {}),
      blockers: Array.isArray(payload.blockers)
        ? payload.blockers.filter((item): item is string => typeof item === "string")
        : []
    };
  } catch {
    return {
      eventId: row.event_id,
      blockers: []
    };
  }
}

function reportEventPayload(input: {
  domain: string;
  status: LaunchReadinessStatus;
  blockers: string[];
  reportPath: string;
  jsonPath: string;
  markdown: string;
  trustSummary: LaunchReadinessTrustSummary;
  data: LaunchReadinessReportData;
}): JsonObject {
  return {
    reportType: "launch_readiness",
    domain: input.domain,
    status: input.status,
    blockers: input.blockers,
    uri: pathToFileURL(input.reportPath).href,
    jsonUri: pathToFileURL(input.jsonPath).href,
    hash: sha256(input.markdown),
    trustSummary: input.trustSummary,
    summary: {
      blockers: input.blockers.length,
      goals: input.data.goals.length,
      tasks: input.data.tasks.length,
      evidence: input.data.evidence.length,
      structuredArtifacts: input.data.structuredArtifacts.length,
      protectedPathChanges: input.data.protectedPathChanges.length
    }
  };
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
