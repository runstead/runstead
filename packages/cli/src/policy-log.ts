import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type PolicyDecisionRecord,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { ActionEnvelope, PolicyEvaluationResult } from "./policy.js";
import { resolveRunsteadRootSync } from "./runstead-root.js";

export interface RecordPolicyDecisionOptions {
  cwd?: string;
  stateDb?: string;
  policyId: string;
  action: ActionEnvelope;
  result: PolicyEvaluationResult;
  now?: Date;
}

export interface RecordPolicyDecisionResult {
  decision: PolicyDecisionRecord;
  event: RunsteadEvent;
  stateDb: string;
}

export function recordPolicyDecision(
  options: RecordPolicyDecisionOptions
): RecordPolicyDecisionResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stateDb =
    options.stateDb ?? join(resolveRunsteadRootSync(cwd).root, "state.db");
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
    result: jsonObject(options.result),
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
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "policyDecision",
        value: decision
      }
    });
  } finally {
    database.close();
  }

  return {
    decision,
    event,
    stateDb
  };
}

function policyDecisionEventPayload(decision: PolicyDecisionRecord): JsonObject {
  return {
    decisionId: decision.id,
    actionId: decision.actionId,
    policyId: decision.policyId,
    decision: decision.decision,
    risk: decision.risk,
    ...(decision.ruleId === undefined ? {} : { ruleId: decision.ruleId })
  };
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
