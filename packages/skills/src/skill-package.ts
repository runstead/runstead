import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SkillStatusSchema = z.enum([
  "candidate",
  "promoted",
  "deprecated",
  "rejected"
]);

export const SkillTriggerSchema = z.union([
  z.string().min(1),
  z.record(z.string().min(1), z.string().min(1))
]);

export const SkillScopeSchema = z.object({
  repos: z.array(z.string().min(1)).optional()
});

export const SkillVerifierSchema = z.object({
  command: z.string().min(1)
});

export const SkillProvenanceSchema = z.object({
  createdFromTasks: z.array(z.string().min(1)),
  author: z.string().min(1)
});

export const SkillPackageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  status: SkillStatusSchema,
  domain: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(SkillTriggerSchema).min(1),
  scope: SkillScopeSchema.optional(),
  allowedTools: z.array(z.string().min(1)),
  deniedTools: z.array(z.string().min(1)),
  permissions: z.record(z.string().min(1), z.string().min(1)),
  verifiers: z.array(SkillVerifierSchema).min(1),
  provenance: SkillProvenanceSchema
});

export type SkillPackage = z.infer<typeof SkillPackageSchema>;

const SkillPackageYamlSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  status: SkillStatusSchema,
  domain: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(SkillTriggerSchema).min(1),
  scope: z
    .object({
      repos: z.array(z.string().min(1)).optional()
    })
    .optional(),
  allowed_tools: z.array(z.string().min(1)),
  denied_tools: z.array(z.string().min(1)),
  permissions: z.record(z.string().min(1), z.string().min(1)),
  verifiers: z.array(SkillVerifierSchema).min(1),
  provenance: z.object({
    created_from_tasks: z.array(z.string().min(1)),
    author: z.string().min(1)
  })
});

export function parseSkillPackage(input: unknown): SkillPackage {
  return SkillPackageSchema.parse(input);
}

export function parseSkillPackageYaml(input: unknown): SkillPackage {
  const parsed = SkillPackageYamlSchema.parse(input);

  return SkillPackageSchema.parse({
    name: parsed.name,
    version: parsed.version,
    status: parsed.status,
    domain: parsed.domain,
    description: parsed.description,
    triggers: parsed.triggers,
    ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
    allowedTools: parsed.allowed_tools,
    deniedTools: parsed.denied_tools,
    permissions: parsed.permissions,
    verifiers: parsed.verifiers,
    provenance: {
      createdFromTasks: parsed.provenance.created_from_tasks,
      author: parsed.provenance.author
    }
  });
}

export async function loadSkillPackageFromFile(path: string): Promise<SkillPackage> {
  const raw = await readFile(path, "utf8");

  return parseSkillPackageYaml(parseYaml(raw));
}
