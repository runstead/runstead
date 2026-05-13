import type {
  ActionEnvelope,
  PolicyEvaluationResult,
  PolicyProfile
} from "./policy.js";
import { evaluatePolicy } from "./policy.js";
import type { ActionRiskScore } from "./risk-scorer.js";
import { scoreActionRisk } from "./risk-scorer.js";
import type { ToolContract } from "./tool-contracts.js";
import { requireToolContract } from "./tool-contracts.js";

export type ToolProxyPreflightStatus = "allowed" | "approval_required" | "denied";

export interface ToolProxyPreflightOptions {
  policy: PolicyProfile;
  action: ActionEnvelope;
}

export interface ToolProxyPreflightResult {
  status: ToolProxyPreflightStatus;
  action: ActionEnvelope;
  contract: ToolContract;
  policyResult: PolicyEvaluationResult;
  riskScore: ActionRiskScore;
}

export function preflightToolAction(
  options: ToolProxyPreflightOptions
): ToolProxyPreflightResult {
  const contract = requireToolContract(options.action.actionType);
  const action = actionWithContractSideEffects(options.action, contract);
  const policyResult = evaluatePolicy({
    policy: options.policy,
    action
  });
  const riskScore = scoreActionRisk({
    action,
    policyResult
  });

  return {
    status: statusFromPolicyDecision(policyResult.decision),
    action,
    contract,
    policyResult,
    riskScore
  };
}

function actionWithContractSideEffects(
  action: ActionEnvelope,
  contract: ToolContract
): ActionEnvelope {
  const sideEffects = unique([
    ...(action.context?.sideEffects ?? []),
    ...contract.sideEffects
  ]);

  return {
    ...action,
    context: {
      ...(action.context ?? {}),
      sideEffects
    }
  };
}

function statusFromPolicyDecision(
  decision: PolicyEvaluationResult["decision"]
): ToolProxyPreflightStatus {
  switch (decision) {
    case "allow":
      return "allowed";
    case "require_approval":
      return "approval_required";
    case "deny":
      return "denied";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
