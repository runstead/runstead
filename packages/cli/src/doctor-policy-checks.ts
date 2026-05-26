import { join } from "node:path";

import { errorMessage, fail, pass, type DoctorCheck } from "./doctor-types.js";
import {
  claudeCodeWorkerAction,
  codexCliWorkerAction,
  codexDirectWorkerAction,
  codexModelInferenceAction
} from "./doctor-worker-helpers.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { evaluatePolicy } from "./policy.js";

export async function checkTrustedLocalCodexPolicy(
  root: string,
  modelResourceId: string
): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const workerDecision = evaluatePolicy({
      policy,
      action: codexDirectWorkerAction()
    });
    const modelDecision = evaluatePolicy({
      policy,
      action: codexModelInferenceAction(modelResourceId)
    });

    if (workerDecision.decision !== "allow" || modelDecision.decision !== "allow") {
      return fail(
        "trusted-local-policy",
        "trusted-local provider policy",
        `worker=${workerDecision.decision} model=${modelDecision.decision} provider=${modelResourceId}; use init --profile trusted-local or run upgrade`
      );
    }

    return pass(
      "trusted-local-policy",
      "trusted-local provider policy",
      `worker rule ${workerDecision.ruleId ?? "default"}, model rule ${modelDecision.ruleId ?? "default"}`
    );
  } catch (error) {
    return fail(
      "trusted-local-policy",
      "trusted-local provider policy",
      errorMessage(error)
    );
  }
}

export async function checkCodexDirectPolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: codexDirectWorkerAction()
    });

    return decision.decision === "allow"
      ? pass(
          "codex-direct-policy",
          "codex_direct policy",
          decision.ruleId ?? "default allow"
        )
      : fail(
          "codex-direct-policy",
          "codex_direct policy",
          `decision=${decision.decision}; Codex Direct requires allow`
        );
  } catch (error) {
    return fail("codex-direct-policy", "codex_direct policy", errorMessage(error));
  }
}

export async function checkCodexCliPolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: codexCliWorkerAction()
    });

    return decision.decision === "allow"
      ? pass("codex-cli-policy", "codex_cli policy", decision.ruleId ?? "default allow")
      : fail(
          "codex-cli-policy",
          "codex_cli policy",
          `decision=${decision.decision}; codex_cli local agent runs require trusted external worker policy`
        );
  } catch (error) {
    return fail("codex-cli-policy", "codex_cli policy", errorMessage(error));
  }
}

export async function checkClaudeCodePolicy(root: string): Promise<DoctorCheck> {
  try {
    const policy = await loadPolicyProfileFromFile(
      join(root, "policies", "repo-maintenance.yaml")
    );
    const decision = evaluatePolicy({
      policy,
      action: claudeCodeWorkerAction()
    });

    return decision.decision === "allow"
      ? pass(
          "claude-code-policy",
          "claude_code policy",
          decision.ruleId ?? "default allow"
        )
      : fail(
          "claude-code-policy",
          "claude_code policy",
          `decision=${decision.decision}; claude_code local agent runs require trusted external worker policy`
        );
  } catch (error) {
    return fail("claude-code-policy", "claude_code policy", errorMessage(error));
  }
}
