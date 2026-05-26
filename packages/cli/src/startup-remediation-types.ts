import type { Task } from "@runstead/core";

import type {
  LocalAgentWorkerKind,
  RunLocalAgentTaskOptions,
  RunLocalAgentTaskResult
} from "./local-agent.js";
import type {
  StartupGateFindingSeverity,
  StartupGateStage
} from "./startup-evidence.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface GenerateStartupRemediationPlanOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  now?: Date;
}

export interface StartupRemediationTaskSummary {
  task: Task;
  blocker: string;
  reused: boolean;
  severity: StartupGateFindingSeverity;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export interface GenerateStartupRemediationPlanResult {
  root: string;
  stateDb: string;
  domain: string;
  stage: StartupGateStage;
  status: "clear" | "blocked";
  blockers: string[];
  reportPath?: string;
  tasks: StartupRemediationTaskSummary[];
  plan: StartupRemediationPlanGraph;
  nextCommands: string[];
}

export interface ExecuteStartupRemediationPlanOptions extends GenerateStartupRemediationPlanOptions {
  worker?: LocalAgentWorkerKind;
  model?: string;
  workerRunner?: WorkerProcessRunner;
  onWorkerProgress?: RunLocalAgentTaskOptions["onWorkerProgress"];
  workerProgressIntervalMs?: number;
  maxTasks?: number;
}

export interface StartupRemediationExecutionSummary {
  remediationTaskId: string;
  localAgentTaskId: string;
  blocker: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  resolved: boolean;
  remainingBlockers: string[];
  gateEventId: string;
  failureEvidenceId?: string;
}

export interface StartupRemediationPlanGraph {
  nodes: StartupRemediationPlanNode[];
  edges: StartupRemediationPlanEdge[];
  budget: StartupRemediationBudget;
}

export interface StartupRemediationPlanNode {
  taskId: string;
  blocker: string;
  severity: StartupGateFindingSeverity;
  acceptanceCriteria: string[];
}

export interface StartupRemediationPlanEdge {
  fromTaskId: string;
  toTaskId: string;
  reason: string;
}

export interface StartupRemediationBudget {
  maxTasks?: number;
  selectedTasks: number;
  skippedTasks: number;
}

export interface ExecuteStartupRemediationPlanResult extends GenerateStartupRemediationPlanResult {
  worker: LocalAgentWorkerKind;
  executed: StartupRemediationExecutionSummary[];
  finalGate: {
    passed: boolean;
    blockers: string[];
    warnings: string[];
    eventId: string;
  };
  executionOutcome: "clear" | "partial" | "blocked";
  budget: StartupRemediationBudget;
  finalReportPath?: string;
}

export interface SupersedeStartupRemediationTasksOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  activeBlockers?: string[];
  runId: string;
  now?: Date;
}

export interface SupersedeStartupRemediationTasksResult {
  root: string;
  stateDb: string;
  supersededTasks: Task[];
}
