import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const GoalTemplateGeneratedSchema = z.object({
  recurringTasks: z.array(z.string().min(1)),
  policyProfile: z.string().min(1).optional(),
  acceptanceContracts: z.array(z.string().min(1))
});

export const GoalTemplateSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  generated: GoalTemplateGeneratedSchema
});

export type GoalTemplate = z.infer<typeof GoalTemplateSchema>;

const GoalTemplateYamlSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  generated: z.object({
    recurring_tasks: z.array(z.string().min(1)).default([]),
    policy_profile: z.string().min(1).optional(),
    acceptance_contracts: z.array(z.string().min(1)).default([])
  })
});

export function parseGoalTemplateYaml(input: unknown): GoalTemplate {
  const parsed = GoalTemplateYamlSchema.parse(input);

  return GoalTemplateSchema.parse({
    id: parsed.id,
    domain: parsed.domain,
    title: parsed.title,
    description: parsed.description,
    generated: {
      recurringTasks: parsed.generated.recurring_tasks,
      policyProfile: parsed.generated.policy_profile,
      acceptanceContracts: parsed.generated.acceptance_contracts
    }
  });
}

export async function loadGoalTemplateFromFile(path: string): Promise<GoalTemplate> {
  const raw = await readFile(path, "utf8");
  return parseGoalTemplateYaml(parseYaml(raw));
}
