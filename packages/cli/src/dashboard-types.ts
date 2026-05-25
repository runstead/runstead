import type { Server } from "node:http";

import type { RunsteadEvent } from "@runstead/core";

import type { StartupStatusResult } from "./startup-status.js";

export interface BuildDashboardOptions {
  cwd?: string;
  outputDir?: string;
  now?: Date;
}

export interface ServeDashboardOptions extends BuildDashboardOptions {
  host?: string;
  port?: number;
  enableOperatorApi?: boolean;
  sessionToken?: string;
  csrfToken?: string;
  actor?: string;
}

export interface BuildDashboardResult {
  cwd: string;
  root: string;
  stateDb: string;
  outputDir: string;
  htmlPath: string;
  dataPath: string;
  operatorActionsPath: string;
  snapshot: DashboardSnapshot;
  event: RunsteadEvent;
}

export interface ServeDashboardResult {
  build: BuildDashboardResult;
  server: Server;
  host: string;
  port: number;
  url: string;
  operatorApi?: DashboardOperatorApiSession;
}

export interface DashboardOperatorApiSession {
  enabled: true;
  sessionToken: string;
  csrfToken: string;
  actor: string;
}

export interface DisabledDashboardOperatorApiSession {
  enabled: false;
}

export type DashboardOperatorApiConfig =
  | DashboardOperatorApiSession
  | DisabledDashboardOperatorApiSession;

export interface DashboardSnapshot {
  generatedAt: string;
  summary: DashboardSummary;
  repositories: DashboardRepository[];
  goals: DashboardGoal[];
  tasks: DashboardTask[];
  approvals: DashboardApproval[];
  events: DashboardEvent[];
  daemon: DashboardDaemonStatus;
  startup: DashboardStartupSnapshot;
  operator: DashboardOperatorConsole;
}

export interface DashboardSummary {
  repositories: number;
  activeGoals: number;
  queuedTasks: number;
  runningTasks: number;
  failedTasks: number;
  pendingApprovals: number;
}

export interface DashboardRepository {
  id: string;
  alias: string;
  localPath: string;
  status: string;
  remoteUrl?: string;
}

export interface DashboardGoal {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: string;
  repositoryAlias?: string;
  updatedAt: string;
}

export interface DashboardTask {
  id: string;
  goalId: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export interface DashboardApproval {
  id: string;
  actionId: string;
  status: string;
  risk: string;
  reason: string;
  updatedAt: string;
}

export interface DashboardEvent {
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: string;
}

export interface DashboardDaemonStatus {
  available: boolean;
  updatedAt?: string;
  pid?: number;
  tick?: number;
  intervalMs?: number;
  ranTask?: boolean;
  reason?: string;
  taskId?: string;
  taskType?: string;
  taskStatus?: string;
  ciRepairStatus?: string;
  branchName?: string;
  approvalId?: string;
  pullRequest?: string;
  eventId?: string;
  ageMs?: number;
  stale?: boolean;
  error?: string;
}

export interface DashboardStartupSnapshot {
  available: boolean;
  status?: StartupStatusResult;
  latestReportPath?: string;
  latestRun?: DashboardStartupRun;
  runComparison?: DashboardStartupRunComparison;
  timelineGroups: DashboardStartupTimelineGroup[];
  staleEvidence: DashboardStartupStaleEvidence[];
  agentPatch?: DashboardStartupAgentPatch;
  error?: string;
}

export interface DashboardStartupRun {
  id: string;
  stage: string;
  target: string;
  status: string;
  verdict: string;
  startedAt?: string;
  completedAt?: string;
  blockers: string[];
  reports: string[];
  uiSmokeArtifacts: string[];
  timeline: DashboardStartupTimelineItem[];
  guidedFlow: DashboardStartupGuidedStep[];
  operatorCommands: DashboardStartupOperatorCommand[];
}

export interface DashboardStartupRunComparison {
  latestCompleted?: DashboardStartupRunSummary;
  latestBlocked?: DashboardStartupRunSummary;
  resolvedBlockers: string[];
  stillBlocked: string[];
  narrative: string;
}

export interface DashboardStartupRunSummary {
  id: string;
  status: string;
  verdict: string;
  target: string;
  startedAt?: string;
  completedAt?: string;
  blockerCount: number;
  phaseStatuses: DashboardStartupRunPhaseSummary[];
}

export interface DashboardStartupRunPhaseSummary {
  phase: string;
  status: string;
}

export interface DashboardStartupTimelineItem {
  phase: string;
  title: string;
  status: string;
  evidence: number;
  artifacts: string[];
  blockers: string[];
  nextAction?: string;
}

export interface DashboardStartupTimelineGroup {
  group:
    | "phases"
    | "worker_runs"
    | "model_requests"
    | "tool_calls"
    | "approvals"
    | "evidence"
    | "reports";
  title: string;
  items: DashboardStartupTimelineEntry[];
}

export interface DashboardStartupTimelineEntry {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  detail?: string;
  artifacts: string[];
}

export interface DashboardStartupGuidedStep {
  id: string;
  title: string;
  status: string;
  resolution: string;
  why: string;
  nextAction: string;
  command?: string;
  blockers: string[];
}

export interface DashboardStartupOperatorCommand {
  kind: string;
  title: string;
  command: string;
  when: string;
}

export interface DashboardStartupStaleEvidence {
  evidenceId: string;
  type: string;
  uri: string;
  ageDays: number;
  freshnessDays: number;
}

export interface DashboardStartupAgentPatch {
  taskId: string;
  workerRunId: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  filesTouched: string[];
  summary: string;
}

export interface DashboardOperatorConsole {
  actions: DashboardOperatorAction[];
  recommendedAction?: DashboardOperatorAction;
  currentRun?: DashboardOperatorRunContext;
  pendingApprovals: DashboardOperatorPendingApproval[];
  blockerCount: number;
  staleEvidenceCount: number;
  recommendedCommand?: string;
}

export interface DashboardOperatorRunContext {
  id: string;
  stage: string;
  target: string;
  status: string;
  verdict: string;
  blockers: string[];
  resumeCommand?: string;
}

export interface DashboardOperatorPendingApproval {
  id: string;
  risk: string;
  reason: string;
  command: string;
}

export interface DashboardOperatorAction {
  id: string;
  title: string;
  command: string;
  reason: string;
  source:
    | "startup_next_action"
    | "startup_run_command"
    | "guided_flow"
    | "daemon_approval";
  status: "ready" | "blocked" | "info";
}
