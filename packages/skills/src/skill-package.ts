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

export const SkillPlatformSchema = z.enum(["macos", "linux", "windows"]);

export const SkillRequiredEnvSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().min(1).optional()
});

const SkillReadinessBaseSchema = z.object({
  platforms: z.array(SkillPlatformSchema).default([]),
  requiredEnv: z.array(SkillRequiredEnvSchema).default([]),
  requiredConnectors: z.array(z.string().min(1)).default([]),
  requiredTools: z.array(z.string().min(1)).default([]),
  requiredWorkers: z.array(z.string().min(1)).default([]),
  fallbackForConnectors: z.array(z.string().min(1)).default([]),
  fallbackForTools: z.array(z.string().min(1)).default([])
});

export const SkillReadinessSchema = SkillReadinessBaseSchema.default(() => ({
  platforms: [],
  requiredEnv: [],
  requiredConnectors: [],
  requiredTools: [],
  requiredWorkers: [],
  fallbackForConnectors: [],
  fallbackForTools: []
}));

export const SkillProvenanceSchema = z.object({
  createdFromTasks: z.array(z.string().min(1)),
  author: z.string().min(1)
});

const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const SkillPackageSchema = z.object({
  name: z.string().regex(SKILL_NAME_PATTERN),
  version: z.string().regex(SEMVER_PATTERN),
  status: SkillStatusSchema,
  domain: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(SkillTriggerSchema).min(1),
  scope: SkillScopeSchema.optional(),
  allowedTools: z.array(z.string().min(1)),
  deniedTools: z.array(z.string().min(1)),
  readiness: SkillReadinessSchema,
  permissions: z.record(z.string().min(1), z.string().min(1)),
  verifiers: z.array(SkillVerifierSchema).min(1),
  provenance: SkillProvenanceSchema
});

export type SkillPackage = z.infer<typeof SkillPackageSchema>;
export type SkillPlatform = z.infer<typeof SkillPlatformSchema>;

const SkillPackageYamlSchema = z.object({
  name: z.string().regex(SKILL_NAME_PATTERN),
  version: z.string().regex(SEMVER_PATTERN),
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
  readiness: z
    .object({
      platforms: z.array(SkillPlatformSchema).default([]),
      required_env: z.array(SkillRequiredEnvSchema).default([]),
      required_connectors: z.array(z.string().min(1)).default([]),
      required_tools: z.array(z.string().min(1)).default([]),
      required_workers: z.array(z.string().min(1)).default([]),
      fallback_for_connectors: z.array(z.string().min(1)).default([]),
      fallback_for_tools: z.array(z.string().min(1)).default([])
    })
    .optional(),
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
    readiness:
      parsed.readiness === undefined
        ? {}
        : {
            platforms: parsed.readiness.platforms,
            requiredEnv: parsed.readiness.required_env,
            requiredConnectors: parsed.readiness.required_connectors,
            requiredTools: parsed.readiness.required_tools,
            requiredWorkers: parsed.readiness.required_workers,
            fallbackForConnectors: parsed.readiness.fallback_for_connectors,
            fallbackForTools: parsed.readiness.fallback_for_tools
          },
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
