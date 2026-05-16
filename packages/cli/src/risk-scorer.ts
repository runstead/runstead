import type { ActionEnvelope, PolicyEvaluationResult, PolicyRisk } from "./policy.js";

export interface ScoreActionRiskOptions {
  action: ActionEnvelope;
  policyResult?: PolicyEvaluationResult;
}

export interface ActionRiskScore {
  risk: PolicyRisk;
  reasons: string[];
}

const ACTION_TYPE_RISK: Record<string, PolicyRisk> = {
  "filesystem.read": "low",
  "filesystem.list": "low",
  "filesystem.search": "low",
  "filesystem.stat": "low",
  "git.status": "low",
  "git.diff": "low",
  "repo.metadata.read": "low",
  "shell.exec": "medium",
  "filesystem.write": "medium",
  "filesystem.patch": "medium",
  "package.install": "high",
  "package.update": "high",
  "github.pr.create": "high"
};

const SIDE_EFFECT_RISK: Record<string, PolicyRisk> = {
  read_workspace: "low",
  execute_process: "medium",
  network_write_external: "high",
  send_message_external: "high",
  git_push: "high",
  github_pr_create: "high",
  secret_access: "critical",
  production_write: "critical"
};

export function scoreActionRisk(options: ScoreActionRiskOptions): ActionRiskScore {
  const candidates: ActionRiskScore[] = [];

  if (options.policyResult !== undefined) {
    candidates.push({
      risk: options.policyResult.risk,
      reasons: [
        options.policyResult.ruleId === undefined
          ? `policy default ${options.policyResult.decision}`
          : `policy rule ${options.policyResult.ruleId}`
      ]
    });
  }

  const actionRisk = ACTION_TYPE_RISK[options.action.actionType];

  if (actionRisk !== undefined) {
    candidates.push({
      risk: actionRisk,
      reasons: [`action type ${options.action.actionType}`]
    });
  }

  for (const sideEffect of options.action.context?.sideEffects ?? []) {
    const sideEffectRisk = SIDE_EFFECT_RISK[sideEffect];

    if (sideEffectRisk !== undefined) {
      candidates.push({
        risk: sideEffectRisk,
        reasons: [`side effect ${sideEffect}`]
      });
    }
  }

  if (candidates.length === 0) {
    return {
      risk: "low",
      reasons: ["no elevated risk signals"]
    };
  }

  const highestRisk = candidates.reduce(
    (highest, candidate) =>
      riskRank(candidate.risk) > riskRank(highest) ? candidate.risk : highest,
    "low" as PolicyRisk
  );

  return {
    risk: highestRisk,
    reasons: candidates
      .filter((candidate) => candidate.risk === highestRisk)
      .flatMap((candidate) => candidate.reasons)
  };
}

function riskRank(risk: PolicyRisk): number {
  switch (risk) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
  }
}
