import type { RunsteadEvent } from "@runstead/core";

export interface GenerateWeeklyReportOptions {
  cwd?: string;
  week?: string;
  now?: Date;
}

export interface WeeklyReportResult {
  root: string;
  stateDb: string;
  week: string;
  periodStart: string;
  periodEnd: string;
  reportPath: string;
  markdown: string;
  event: RunsteadEvent;
}

export interface WeeklyReportData {
  goals: GoalReportRow[];
  tasks: TaskReportRow[];
  evidence: EvidenceReportRow[];
  policyDecisions: PolicyDecisionReportRow[];
  approvals: ApprovalReportRow[];
  events: EventReportRow[];
}

export interface GoalReportRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface TaskReportRow {
  id: string;
  goal_id: string;
  domain: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  updated_at: string;
}

export interface EvidenceReportRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

export interface PolicyDecisionReportRow {
  id: string;
  action_id: string;
  policy_id: string;
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
  created_at: string;
  updated_at: string;
}

export interface EventReportRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  created_at: string;
}
