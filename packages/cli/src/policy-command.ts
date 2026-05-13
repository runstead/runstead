import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import type {
  ActionEnvelope,
  PolicyEvaluationResult,
  PolicyProfile
} from "./policy.js";
import { evaluatePolicy } from "./policy.js";
import { loadPolicyProfileFromFile, parseActionEnvelopeYaml } from "./policy-loader.js";

export interface TestPolicyActionOptions {
  policyPath: string;
  actionPath: string;
}

export interface TestPolicyActionResult {
  policy: PolicyProfile;
  action: ActionEnvelope;
  result: PolicyEvaluationResult;
}

export async function testPolicyAction(
  options: TestPolicyActionOptions
): Promise<TestPolicyActionResult> {
  const policy = await loadPolicyProfileFromFile(options.policyPath);
  const actionRaw = await readFile(options.actionPath, "utf8");
  const action = parseActionEnvelopeYaml(parseYaml(actionRaw));
  const result = evaluatePolicy({ policy, action });

  return {
    policy,
    action,
    result
  };
}

export function formatPolicyTestReport(report: TestPolicyActionResult): string {
  const lines = [
    `Policy: ${report.policy.id}`,
    `Action: ${report.action.actionId}`,
    `Decision: ${report.result.decision}`,
    `Risk: ${report.result.risk}`,
    `Rule: ${report.result.ruleId ?? "none"}`,
    `Reason: ${report.result.reason}`
  ];

  if (report.result.obligations.length > 0) {
    lines.push("Obligations:");
    for (const obligation of report.result.obligations) {
      lines.push(`  ${obligation}`);
    }
  }

  return lines.join("\n");
}
