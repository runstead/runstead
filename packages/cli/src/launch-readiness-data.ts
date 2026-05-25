import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { RepoInspectionSnapshot } from "./inspection-evidence.js";
import type { StartupArtifactListItem } from "./startup-artifacts.js";
import type { CommandVerifierCodeState } from "./verifier-evidence.js";

export interface GoalReportRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface TaskReportRow {
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

export interface EvidenceReportRow {
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

export interface PolicyDecisionReportRow {
  id: string;
  action_id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
  created_at: string;
}

export interface ApprovalReportRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

export interface PreviousLaunchReadinessReport {
  eventId: string;
  status?: string;
  blockers: string[];
}

export interface EvidenceProvenanceArtifact {
  sources?: unknown;
  provenance?: unknown;
  codeState?: unknown;
  verifier?: unknown;
  command?: unknown;
}

export interface LaunchReadinessReportData {
  generatedAt: string;
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

export function readLaunchReadinessData(
  database: RunsteadDatabase,
  domain: string
): Omit<
  LaunchReadinessReportData,
  | "generatedAt"
  | "repo"
  | "protectedPathChanges"
  | "gate"
  | "structuredArtifacts"
  | "currentCodeState"
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
