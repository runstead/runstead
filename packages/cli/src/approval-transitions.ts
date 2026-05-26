import {
  ApprovalRequestSchema,
  createRunsteadId,
  type ApprovalRequest,
  type JsonObject,
  type PolicyDecisionRecord,
  type RunsteadEvent
} from "@runstead/core";
import type {
  AppendEventAndProjectInput,
  RunsteadDatabase
} from "@runstead/state-sqlite";

import { findPolicyDecision } from "./approval-rows.js";

export interface CreateApprovalRequestTransitionOptions {
  policyDecision: PolicyDecisionRecord;
  requestedBy?: string;
  expiresAt?: string;
  now?: Date;
}

export interface CreateApprovalExpirationTransitionOptions {
  database: RunsteadDatabase;
  approval: ApprovalRequest;
  now?: Date;
}

export interface CreateApprovalDecisionTransitionOptions {
  approval: ApprovalRequest;
  policyDecision?: PolicyDecisionRecord;
  decidedAt: string;
}

export interface ApprovalTransition {
  approval: ApprovalRequest;
  event: RunsteadEvent;
  entry: AppendEventAndProjectInput;
}

export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export function createApprovalRequestTransition(
  options: CreateApprovalRequestTransitionOptions
): ApprovalTransition {
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt =
    options.expiresAt ??
    new Date(now.getTime() + DEFAULT_APPROVAL_TTL_MS).toISOString();
  const approval = ApprovalRequestSchema.parse({
    id: createRunsteadId("appr"),
    policyDecisionId: options.policyDecision.id,
    actionId: options.policyDecision.actionId,
    status: "pending",
    risk: options.policyDecision.risk,
    reason: options.policyDecision.reason,
    requestedBy: options.requestedBy ?? "runstead",
    expiresAt,
    createdAt,
    updatedAt: createdAt
  });
  const event = approvalEvent(
    "approval.requested",
    approval,
    approvalPayload(approval, options.policyDecision),
    createdAt
  );

  return {
    approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: approval
      }
    }
  };
}

export function createApprovalExpirationTransition(
  options: CreateApprovalExpirationTransitionOptions
): ApprovalTransition {
  const expiredAt = (options.now ?? new Date()).toISOString();
  const approval: ApprovalRequest = {
    ...options.approval,
    status: "expired",
    updatedAt: expiredAt
  };
  const event = approvalEvent(
    "approval.expired",
    approval,
    approvalPayload(
      approval,
      findPolicyDecision(options.database, approval.policyDecisionId)
    ),
    expiredAt
  );

  return {
    approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: approval
      }
    }
  };
}

export function createApprovalDecisionTransition(
  options: CreateApprovalDecisionTransitionOptions
): ApprovalTransition {
  const event = approvalEvent(
    options.approval.status === "approved" ? "approval.approved" : "approval.denied",
    options.approval,
    approvalPayload(options.approval, options.policyDecision),
    options.decidedAt
  );

  return {
    approval: options.approval,
    event,
    entry: {
      event,
      projection: {
        type: "approval",
        value: options.approval
      }
    }
  };
}

function approvalEvent(
  type: string,
  approval: ApprovalRequest,
  payload: JsonObject,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type,
    aggregateType: "approval",
    aggregateId: approval.id,
    payload,
    createdAt
  };
}

function approvalPayload(
  approval: ApprovalRequest,
  policyDecision?: PolicyDecisionRecord
): JsonObject {
  const policyFingerprint = policyDecision?.result.policyFingerprint;

  return {
    approvalId: approval.id,
    policyDecisionId: approval.policyDecisionId,
    actionId: approval.actionId,
    status: approval.status,
    risk: approval.risk,
    reason: approval.reason,
    ...(policyDecision === undefined
      ? {}
      : {
          policyId: policyDecision.policyId,
          action: policyDecision.action,
          obligations: policyDecision.obligations,
          ...(typeof policyFingerprint === "string" ? { policyFingerprint } : {})
        }),
    ...(approval.expiresAt === undefined ? {} : { expiresAt: approval.expiresAt }),
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
    ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy })
  };
}
