import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { ActionEnvelope, PolicyProfile } from "./policy.js";

const PolicyDecisionSchema = z.enum(["allow", "deny", "require_approval"]);
const PolicyRiskSchema = z.enum(["low", "medium", "high", "critical"]);
const MatchesAnyYamlSchema = z.object({
  matches_any: z.array(z.string().min(1))
});
const ContainsAnyYamlSchema = z.object({
  contains_any: z.array(z.string().min(1))
});
const StringOrInYamlSchema = z.union([
  z.string().min(1),
  z.object({
    in: z.array(z.string().min(1))
  })
]);
const ActionTypeYamlSchema = StringOrInYamlSchema;
const PolicyRuleYamlSchema = z.object({
  id: z.string().min(1),
  when: z.object({
    action_type: ActionTypeYamlSchema.optional(),
    resource_id: StringOrInYamlSchema.optional(),
    risk_class: StringOrInYamlSchema.optional(),
    path: MatchesAnyYamlSchema.optional(),
    command: MatchesAnyYamlSchema.optional(),
    side_effects: ContainsAnyYamlSchema.optional()
  }),
  decision: PolicyDecisionSchema,
  risk: PolicyRiskSchema,
  obligations: z.array(z.string().min(1)).optional()
});
const PolicyProfileYamlSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  default_decision: PolicyDecisionSchema.optional(),
  default_risk: PolicyRiskSchema.optional(),
  rules: z.array(PolicyRuleYamlSchema)
});
const ActionEnvelopeYamlSchema = z.object({
  action_id: z.string().min(1),
  action_type: z.string().min(1),
  resource: z
    .object({
      type: z.string().min(1),
      id: z.string().min(1).optional(),
      path: z.string().min(1).optional()
    })
    .optional(),
  context: z
    .object({
      cwd: z.string().min(1).optional(),
      command: z.string().min(1).optional(),
      files_touched: z.array(z.string().min(1)).optional(),
      risk_class: z.string().min(1).optional(),
      network_domains: z.array(z.string().min(1)).optional(),
      secrets_requested: z.array(z.string().min(1)).optional(),
      side_effects: z.array(z.string().min(1)).optional()
    })
    .optional()
});

export async function loadPolicyProfileFromFile(path: string): Promise<PolicyProfile> {
  const raw = await readFile(path, "utf8");

  return parsePolicyProfileYaml(parseYaml(raw));
}

export function parsePolicyProfileYaml(input: unknown): PolicyProfile {
  const parsed = PolicyProfileYamlSchema.parse(input);

  assertUniquePolicyRuleIds(parsed.rules.map((rule) => rule.id));
  assertValidCommandMatchers(parsed.rules);

  return {
    id: parsed.id,
    version: parsed.version,
    ...(parsed.default_decision === undefined
      ? {}
      : { defaultDecision: parsed.default_decision }),
    ...(parsed.default_risk === undefined ? {} : { defaultRisk: parsed.default_risk }),
    rules: parsed.rules.map((rule) => ({
      id: rule.id,
      when: {
        ...(rule.when.action_type === undefined
          ? {}
          : { actionType: actionTypeFromYaml(rule.when.action_type) }),
        ...(rule.when.resource_id === undefined
          ? {}
          : { resourceId: stringOrInFromYaml(rule.when.resource_id) }),
        ...(rule.when.risk_class === undefined
          ? {}
          : { riskClass: stringOrInFromYaml(rule.when.risk_class) }),
        ...(rule.when.path === undefined
          ? {}
          : { path: { matchesAny: rule.when.path.matches_any } }),
        ...(rule.when.command === undefined
          ? {}
          : { command: { matchesAny: rule.when.command.matches_any } }),
        ...(rule.when.side_effects === undefined
          ? {}
          : {
              sideEffects: {
                containsAny: rule.when.side_effects.contains_any
              }
            })
      },
      decision: rule.decision,
      risk: rule.risk,
      ...(rule.obligations === undefined ? {} : { obligations: rule.obligations })
    }))
  };
}

function assertValidCommandMatchers(
  rules: z.infer<typeof PolicyProfileYamlSchema>["rules"]
): void {
  for (const rule of rules) {
    for (const pattern of rule.when.command?.matches_any ?? []) {
      try {
        new RegExp(pattern);
      } catch (error) {
        throw new Error(
          `Invalid command matcher regex in policy rule ${rule.id}: ${pattern} (${errorMessage(error)})`,
          { cause: error }
        );
      }
    }
  }
}

function assertUniquePolicyRuleIds(ruleIds: string[]): void {
  const seen = new Set<string>();

  for (const ruleId of ruleIds) {
    if (seen.has(ruleId)) {
      throw new Error(`Duplicate policy rule id: ${ruleId}`);
    }

    seen.add(ruleId);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseActionEnvelopeYaml(input: unknown): ActionEnvelope {
  const parsed = ActionEnvelopeYamlSchema.parse(input);

  return {
    actionId: parsed.action_id,
    actionType: parsed.action_type,
    ...(parsed.resource === undefined
      ? {}
      : {
          resource: {
            type: parsed.resource.type,
            ...(parsed.resource.id === undefined ? {} : { id: parsed.resource.id }),
            ...(parsed.resource.path === undefined
              ? {}
              : { path: parsed.resource.path })
          }
        }),
    ...(parsed.context === undefined
      ? {}
      : {
          context: {
            ...(parsed.context.cwd === undefined ? {} : { cwd: parsed.context.cwd }),
            ...(parsed.context.command === undefined
              ? {}
              : { command: parsed.context.command }),
            ...(parsed.context.files_touched === undefined
              ? {}
              : { filesTouched: parsed.context.files_touched }),
            ...(parsed.context.risk_class === undefined
              ? {}
              : { riskClass: parsed.context.risk_class }),
            ...(parsed.context.network_domains === undefined
              ? {}
              : { networkDomains: parsed.context.network_domains }),
            ...(parsed.context.secrets_requested === undefined
              ? {}
              : { secretsRequested: parsed.context.secrets_requested }),
            ...(parsed.context.side_effects === undefined
              ? {}
              : { sideEffects: parsed.context.side_effects })
          }
        })
  };
}

function actionTypeFromYaml(
  actionType: z.infer<typeof ActionTypeYamlSchema>
): string | string[] {
  return stringOrInFromYaml(actionType);
}

function stringOrInFromYaml(
  value: z.infer<typeof StringOrInYamlSchema>
): string | string[] {
  return typeof value === "string" ? value : value.in;
}
