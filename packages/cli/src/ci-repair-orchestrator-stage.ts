export type CiRepairOrchestratorProgressStage =
  | "created"
  | "intake_completed"
  | "claimed"
  | "branch_created"
  | "checkpoint_created"
  | "worker_completed"
  | "committed"
  | "verified"
  | "ready_for_push"
  | "publish_approval_requested"
  | "publish_approved"
  | "push_approval_requested"
  | "branch_pushed"
  | "pr_approval_requested"
  | "completed";

export type CiRepairOrchestratorTerminalStage = "failed" | "blocked" | "cancelled";

export type CiRepairOrchestratorStage =
  | CiRepairOrchestratorProgressStage
  | CiRepairOrchestratorTerminalStage;

const CI_REPAIR_PROGRESS_STAGE_ORDER: CiRepairOrchestratorProgressStage[] = [
  "created",
  "intake_completed",
  "claimed",
  "branch_created",
  "checkpoint_created",
  "worker_completed",
  "committed",
  "verified",
  "ready_for_push",
  "publish_approval_requested",
  "publish_approved",
  "push_approval_requested",
  "branch_pushed",
  "pr_approval_requested",
  "completed"
];

export function ciRepairProgressStageAtLeast(
  stage: string,
  target: CiRepairOrchestratorProgressStage
): boolean {
  const stageRank = ciRepairProgressStageRank(stage);
  const targetRank = ciRepairProgressStageRank(target);

  return stageRank >= 0 && targetRank >= 0 && stageRank >= targetRank;
}

function ciRepairProgressStageRank(stage: string): number {
  return CI_REPAIR_PROGRESS_STAGE_ORDER.indexOf(
    stage as CiRepairOrchestratorProgressStage
  );
}
