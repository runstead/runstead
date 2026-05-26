import type {
  CiRepairOrchestratorResumeContext,
  CiRepairOrchestratorStageContext,
  PublishCoverage
} from "./ci-repair-orchestrator-context-types.js";

export function publishCoverageFromContext(
  context: CiRepairOrchestratorResumeContext
): PublishCoverage | undefined {
  if (
    context.publishToolCallId === undefined ||
    context.publishPolicyDecisionId === undefined
  ) {
    return undefined;
  }

  return {
    toolCallId: context.publishToolCallId,
    policyDecisionId: context.publishPolicyDecisionId,
    ...(context.publishApprovalId === undefined
      ? {}
      : { approvalId: context.publishApprovalId })
  };
}

export function publishCoverageStagePatch(
  coverage: PublishCoverage
): Partial<CiRepairOrchestratorStageContext> {
  return {
    publishToolCallId: coverage.toolCallId,
    publishPolicyDecisionId: coverage.policyDecisionId,
    ...(coverage.approvalId === undefined
      ? {}
      : { publishApprovalId: coverage.approvalId })
  };
}
