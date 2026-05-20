import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  collectRepoInspection,
  type RepoInspectionSnapshot
} from "./inspection-evidence.js";
import { matchesPolicyPathPattern } from "./policy.js";
import { requireRunsteadStateDb } from "./runstead-root.js";

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
  markdown: string;
  event: RunsteadEvent;
  status: LaunchReadinessStatus;
  blockers: string[];
}

type LaunchReadinessStatus = "launch_ready" | "blocked";

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

interface LaunchReadinessReportData {
  repo: RepoInspectionSnapshot;
  protectedPathChanges: string[];
  goals: GoalReportRow[];
  tasks: TaskReportRow[];
  evidence: EvidenceReportRow[];
  policyDecisions: PolicyDecisionReportRow[];
  approvals: ApprovalReportRow[];
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
      ...readLaunchReadinessData(database, domain)
    };
    const blockers = releaseBlockers(data);
    const status: LaunchReadinessStatus =
      blockers.length === 0 ? "launch_ready" : "blocked";
    const markdown = formatLaunchReadinessReport({
      generatedAt,
      domain,
      status,
      blockers,
      data
    });
    const reportPath = join(
      resolvedState.root,
      "reports",
      `launch-readiness-${domain}.md`
    );
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "report.generated",
      aggregateType: "report",
      aggregateId: `launch_readiness_${domain.replaceAll("-", "_")}`,
      payload: reportEventPayload({
        domain,
        status,
        blockers,
        reportPath,
        markdown,
        data
      }),
      createdAt: generatedAt
    };

    await mkdir(join(resolvedState.root, "reports"), { recursive: true });
    await writeFile(reportPath, markdown, "utf8");
    appendEventAndProject(database, { event });

    return {
      root: resolvedState.root,
      stateDb,
      domain,
      reportPath,
      markdown,
      event,
      status,
      blockers
    };
  } finally {
    database.close();
  }
}

function readLaunchReadinessData(
  database: ReturnType<typeof openRunsteadDatabase>,
  domain: string
): Omit<LaunchReadinessReportData, "repo" | "protectedPathChanges"> {
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
      SELECT DISTINCT e.id, e.type, e.subject_type, e.subject_id, e.uri,
             e.summary, e.created_at
      FROM evidence e
      LEFT JOIN tasks t ON e.subject_type = 'task' AND e.subject_id = t.id
      WHERE t.domain = ?
         OR e.type = 'repo_inspection'
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
  data: LaunchReadinessReportData;
}): string {
  return [
    "# Runstead Launch Readiness Report",
    "",
    `Domain: ${input.domain}`,
    `Generated: ${input.generatedAt}`,
    `Status: ${input.status}`,
    "",
    "## Repo Health",
    "",
    repoHealth(input.data.repo),
    "",
    "## Verifier Status",
    "",
    verifierStatus(input.data),
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
    "## Release Blockers",
    "",
    listOrNone(input.blockers, (blocker) => `- ${blocker}`),
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

function verifierStatus(data: LaunchReadinessReportData): string {
  const verifierTasks = data.tasks.filter(
    (task) => task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers"
  );
  const commandEvidence = data.evidence.filter(
    (item) => item.type === "command_output"
  );

  return [
    `- Verifier tasks: ${formatTaskCounts(verifierTasks)}`,
    `- Command evidence records: ${commandEvidence.length}`,
    ...commandEvidence.map(
      (item) => `- ${item.id}: ${item.summary ?? item.uri} (${item.created_at})`
    )
  ].join("\n");
}

function testCoverageGaps(data: LaunchReadinessReportData): string {
  const gaps = [
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...(hasCompletedTask(data.tasks, "run_mvp_verifiers")
      ? []
      : ["run_mvp_verifiers has not completed"]),
    ...(hasEvidenceType(data.evidence, "command_output")
      ? []
      : ["no command_output evidence is recorded"])
  ];

  return listOrNone(gaps, (gap) => `- ${gap}`);
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
  if (risk.includes("protected path")) return "git status protected path scan";
  if (risk.includes("approval")) return "approval ledger";

  return "launch readiness analysis";
}

function evidenceSource(data: LaunchReadinessReportData, type: string): string {
  const evidence = data.evidence.find((item) => item.type === type);

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
  if (risk.includes("protected path"))
    return "create review evidence for protected paths";
  if (risk.includes("approval")) return "resolve pending approval before launch";

  return "create a remediation task and attach evidence";
}

function releaseBlockers(data: LaunchReadinessReportData): string[] {
  return [
    ...(data.goals.length === 0 ? ["no startup goal exists"] : []),
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...(data.repo.ci.detected ? [] : ["CI configuration is missing"]),
    ...(hasCompletedTask(data.tasks, "run_mvp_verifiers")
      ? []
      : ["MVP verifier task has not completed"]),
    ...(hasEvidenceType(data.evidence, "command_output")
      ? []
      : ["verifier command evidence is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_measurement_framework") ||
    hasCompletedTask(data.tasks, "define_measurement_framework")
      ? []
      : ["measurement framework is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_repo_readiness")
      ? []
      : ["repo readiness audit is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_security_baseline")
      ? []
      : ["security baseline is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_migration_plan")
      ? []
      : ["migration plan evidence is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_rollback_plan")
      ? []
      : ["rollback plan evidence is missing"]),
    ...(hasEvidenceType(data.evidence, "startup_observability")
      ? []
      : ["observability evidence is missing"]),
    ...(data.protectedPathChanges.length === 0
      ? []
      : [
          `protected path changes require review: ${data.protectedPathChanges.join(", ")}`
        ]),
    ...data.tasks
      .filter((task) => ["failed", "blocked", "waiting_approval"].includes(task.status))
      .map((task) => `${task.type} is ${task.status}`),
    ...data.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => `approval ${approval.id} is pending`)
  ];
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

function reportEventPayload(input: {
  domain: string;
  status: LaunchReadinessStatus;
  blockers: string[];
  reportPath: string;
  markdown: string;
  data: LaunchReadinessReportData;
}): JsonObject {
  return {
    reportType: "launch_readiness",
    domain: input.domain,
    status: input.status,
    uri: pathToFileURL(input.reportPath).href,
    hash: sha256(input.markdown),
    summary: {
      blockers: input.blockers.length,
      goals: input.data.goals.length,
      tasks: input.data.tasks.length,
      evidence: input.data.evidence.length,
      protectedPathChanges: input.data.protectedPathChanges.length
    }
  };
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
