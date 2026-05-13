import { z } from "zod";

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const GoalStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "failed",
  "archived"
]);

export const TaskStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const GoalSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  title: z.string().min(1),
  status: GoalStatusSchema,
  priority: PrioritySchema,
  scope: JsonObjectSchema,
  budget: JsonObjectSchema.optional(),
  policyRef: z.string().min(1).optional(),
  acceptanceRef: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type Goal = z.infer<typeof GoalSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  domain: z.string().min(1),
  type: z.string().min(1),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  input: JsonObjectSchema,
  output: JsonObjectSchema.optional(),
  verifiers: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type Task = z.infer<typeof TaskSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  uri: z.string().min(1),
  hash: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  createdAt: z.string().min(1)
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const RunsteadEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  payload: JsonObjectSchema,
  createdAt: z.string().min(1)
});

export type RunsteadEvent = z.infer<typeof RunsteadEventSchema>;
