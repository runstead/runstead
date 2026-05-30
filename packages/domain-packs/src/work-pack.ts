import { z } from "zod";

import type { DomainPack } from "./domain-pack.js";
import type { DomainPackRegistryEntry, DomainPackRegistrySource } from "./registry.js";

export const WorkPackComponentKindSchema = z.enum([
  "domain_pack",
  "extension",
  "skill"
]);

export const WorkPackWorkflowKindSchema = z.enum(["goal_template", "task_type"]);

export const WorkPackComponentSchema = z.object({
  kind: WorkPackComponentKindSchema,
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  source: z.string().min(1).optional()
});

export const WorkPackWorkflowSchema = z.object({
  id: z.string().min(1),
  kind: WorkPackWorkflowKindSchema,
  source: z.string().min(1)
});

export const WorkPackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  source: z.enum(["built_in", "workspace", "path", "inline"]),
  domain: WorkPackComponentSchema,
  extensions: z.array(WorkPackComponentSchema),
  skills: z.array(WorkPackComponentSchema),
  workflows: z.array(WorkPackWorkflowSchema),
  resourceTypes: z.array(z.string().min(1)),
  supportedWorkers: z.array(z.string().min(1))
});

export type WorkPackComponentKind = z.infer<typeof WorkPackComponentKindSchema>;
export type WorkPackWorkflowKind = z.infer<typeof WorkPackWorkflowKindSchema>;
export type WorkPackComponent = z.infer<typeof WorkPackComponentSchema>;
export type WorkPackWorkflow = z.infer<typeof WorkPackWorkflowSchema>;
export type WorkPack = z.infer<typeof WorkPackSchema>;

export interface DomainPackWorkPackOptions {
  source?: DomainPackRegistrySource | "inline";
  extensions?: WorkPackComponent[];
  skills?: WorkPackComponent[];
}

export function domainPackToWorkPack(
  domain: DomainPack,
  options: DomainPackWorkPackOptions = {}
): WorkPack {
  return WorkPackSchema.parse({
    schemaVersion: 1,
    id: domain.id,
    version: domain.version,
    name: domain.name,
    description: domain.description,
    source: options.source ?? "inline",
    domain: {
      kind: "domain_pack",
      id: domain.id,
      label: domain.name
    },
    extensions: options.extensions ?? [],
    skills: options.skills ?? [],
    workflows: [
      ...domain.goalTemplates.map((id) => ({
        id,
        kind: "goal_template" as const,
        source: "domain.goalTemplates"
      })),
      ...domain.taskTypes.map((id) => ({
        id,
        kind: "task_type" as const,
        source: "domain.taskTypes"
      }))
    ],
    resourceTypes: domain.scope?.resourceTypes ?? [],
    supportedWorkers: domain.supportedWorkers
  });
}

export function domainPackRegistryEntryToWorkPack(
  entry: DomainPackRegistryEntry,
  options: Omit<DomainPackWorkPackOptions, "source"> = {}
): WorkPack {
  return domainPackToWorkPack(entry.domain, {
    source: entry.source,
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    ...(options.skills === undefined ? {} : { skills: options.skills })
  });
}
