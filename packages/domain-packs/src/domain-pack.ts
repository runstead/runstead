import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const DomainPackScopeSchema = z.object({
  resourceTypes: z.array(z.string().min(1))
});

export const DomainPackSecuritySchema = z.object({
  untrustedInputs: z.array(z.string().min(1)),
  protectedPaths: z.array(z.string().min(1))
});

export const DomainPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: DomainPackScopeSchema.optional(),
  goalTemplates: z.array(z.string().min(1)),
  taskTypes: z.array(z.string().min(1)),
  defaultPolicy: z.string().min(1),
  defaultVerifiers: z.array(z.string().min(1)),
  requiredTools: z.array(z.string().min(1)),
  supportedWorkers: z.array(z.string().min(1)),
  security: DomainPackSecuritySchema.optional()
});

export type DomainPack = z.infer<typeof DomainPackSchema>;

const DomainPackYamlSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  scope: z
    .object({
      resource_types: z.array(z.string().min(1))
    })
    .optional(),
  goal_templates: z.array(z.string().min(1)),
  task_types: z.array(z.string().min(1)),
  default_policy: z.string().min(1),
  default_verifiers: z.array(z.string().min(1)),
  required_tools: z.array(z.string().min(1)),
  supported_workers: z.array(z.string().min(1)),
  security: z
    .object({
      untrusted_inputs: z.array(z.string().min(1)),
      protected_paths: z.array(z.string().min(1))
    })
    .optional()
});

export function parseDomainPack(input: unknown): DomainPack {
  return DomainPackSchema.parse(input);
}

export function parseDomainPackYaml(input: unknown): DomainPack {
  const parsed = DomainPackYamlSchema.parse(input);

  return DomainPackSchema.parse({
    id: parsed.id,
    version: parsed.version,
    name: parsed.name,
    description: parsed.description,
    scope:
      parsed.scope === undefined
        ? undefined
        : {
            resourceTypes: parsed.scope.resource_types
          },
    goalTemplates: parsed.goal_templates,
    taskTypes: parsed.task_types,
    defaultPolicy: parsed.default_policy,
    defaultVerifiers: parsed.default_verifiers,
    requiredTools: parsed.required_tools,
    supportedWorkers: parsed.supported_workers,
    security:
      parsed.security === undefined
        ? undefined
        : {
            untrustedInputs: parsed.security.untrusted_inputs,
            protectedPaths: parsed.security.protected_paths
          }
  });
}

export async function loadDomainPackFromFile(path: string): Promise<DomainPack> {
  const raw = await readFile(path, "utf8");
  return parseDomainPackYaml(parseYaml(raw));
}
