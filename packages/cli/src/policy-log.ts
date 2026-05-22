import { resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type PolicyDecisionRecord,
  type RunsteadEvent
} from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type AppendEventAndProjectInput
} from "@runstead/state-sqlite";

import type { ActionEnvelope, PolicyEvaluationResult } from "./policy.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface RecordPolicyDecisionOptions {
  cwd?: string;
  stateDb?: string;
  policyId: string;
  policyFingerprint?: string;
  action: ActionEnvelope;
  result: PolicyEvaluationResult;
  now?: Date;
}

export interface RecordPolicyDecisionResult {
  decision: PolicyDecisionRecord;
  event: RunsteadEvent;
  stateDb: string;
}

export interface PolicyDecisionTransition {
  decision: PolicyDecisionRecord;
  event: RunsteadEvent;
  entry: AppendEventAndProjectInput;
}

export function createPolicyDecisionTransition(
  options: Omit<RecordPolicyDecisionOptions, "cwd" | "stateDb">
): PolicyDecisionTransition {
  const createdAt = (options.now ?? new Date()).toISOString();
  const decision: PolicyDecisionRecord = {
    id: createRunsteadId("poldec"),
    actionId: options.action.actionId,
    policyId: options.policyId,
    decision: options.result.decision,
    risk: options.result.risk,
    ...(options.result.ruleId === undefined ? {} : { ruleId: options.result.ruleId }),
    reason: options.result.reason,
    obligations: options.result.obligations,
    action: jsonObject(options.action),
    result: jsonObject({
      ...options.result,
      ...(options.policyFingerprint === undefined
        ? {}
        : { policyFingerprint: options.policyFingerprint })
    }),
    createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "policy.decision_recorded",
    aggregateType: "policy_decision",
    aggregateId: decision.id,
    payload: policyDecisionEventPayload(decision),
    createdAt
  };

  return {
    decision,
    event,
    entry: {
      event,
      projection: {
        type: "policyDecision",
        value: decision
      }
    }
  };
}

export function recordPolicyDecision(
  options: RecordPolicyDecisionOptions
): RecordPolicyDecisionResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb = options.stateDb ?? requireRunsteadStateDbSync(cwd).stateDb;
  const transition = createPolicyDecisionTransition(options);
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, transition.entry);
  } finally {
    database.close();
  }

  return {
    decision: transition.decision,
    event: transition.event,
    stateDb
  };
}

function policyDecisionEventPayload(decision: PolicyDecisionRecord): JsonObject {
  const policyFingerprint = decision.result.policyFingerprint;

  return {
    decisionId: decision.id,
    actionId: decision.actionId,
    policyId: decision.policyId,
    ...(typeof policyFingerprint === "string" ? { policyFingerprint } : {}),
    decision: decision.decision,
    risk: decision.risk,
    ...(decision.ruleId === undefined ? {} : { ruleId: decision.ruleId })
  };
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
