import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const TaskTypePrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const TaskTypeVerifiersSchema = z.object({
  required: z.array(z.string().min(1))
});

export const TaskTypeWorkerRoutingSchema = z.object({
  preferred: z.string().min(1),
  fallback: z.array(z.string().min(1)).optional()
});

export const TaskTypeSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  description: z.string().min(1),
  defaultPriority: TaskTypePrioritySchema,
  maxAttempts: z.number().int().positive(),
  verifiers: TaskTypeVerifiersSchema,
  workerRouting: TaskTypeWorkerRoutingSchema
});

export type TaskType = z.infer<typeof TaskTypeSchema>;

const TaskTypeYamlSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  description: z.string().min(1),
  default_priority: TaskTypePrioritySchema,
  max_attempts: z.number().int().positive(),
  verifiers: z.object({
    required: z.array(z.string().min(1))
  }),
  worker_routing: z.object({
    preferred: z.string().min(1),
    fallback: z.array(z.string().min(1)).optional()
  })
});

export function parseTaskTypeYaml(input: unknown): TaskType {
  const parsed = TaskTypeYamlSchema.parse(input);

  return TaskTypeSchema.parse({
    id: parsed.id,
    domain: parsed.domain,
    description: parsed.description,
    defaultPriority: parsed.default_priority,
    maxAttempts: parsed.max_attempts,
    verifiers: parsed.verifiers,
    workerRouting: {
      preferred: parsed.worker_routing.preferred,
      ...(parsed.worker_routing.fallback === undefined
        ? {}
        : { fallback: parsed.worker_routing.fallback })
    }
  });
}

export async function loadTaskTypeFromFile(path: string): Promise<TaskType> {
  const raw = await readFile(path, "utf8");
  return parseTaskTypeYaml(parseYaml(raw));
}
