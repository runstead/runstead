import type {
  ApprovalRequest,
  JsonObject,
  PolicyDecisionRecord,
  Task,
  ToolCall,
  WorkerRun
} from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { ActionEnvelope, PolicyProfile } from "./policy.js";

export interface RunGovernedToolActionOptions<T> {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  action: ActionEnvelope;
  requestedBy: string;
  now?: Date;
  run: () => Promise<{ value: T; output?: JsonObject }>;
}

export interface RunGovernedToolActionResult<T> {
  value: T;
  toolCall: ToolCall;
  policyDecision: PolicyDecisionRecord;
  approval?: ApprovalRequest;
}

export class ToolActionDeniedError extends Error {
  constructor(
    message: string,
    readonly toolCall: ToolCall,
    readonly policyDecision: PolicyDecisionRecord
  ) {
    super(message);
  }
}

export class ToolActionApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly toolCall: ToolCall,
    readonly policyDecision: PolicyDecisionRecord,
    readonly approval: ApprovalRequest
  ) {
    super(message);
  }
}
