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
  "waiting_approval",
  "blocked",
  "interrupted",
  "completed",
  "failed",
  "cancelled"
]);

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const PolicyDecisionValueSchema = z.enum(["allow", "deny", "require_approval"]);

export const PolicyRiskSchema = z.enum(["low", "medium", "high", "critical"]);

export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired"
]);

export const WorkerRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "interrupted",
  "waiting_approval",
  "blocked"
]);

export const ToolCallStatusSchema = z.enum([
  "requested",
  "allowed",
  "approval_required",
  "denied",
  "running",
  "completed",
  "failed"
]);

export const MemoryTypeSchema = z.enum([
  "project_fact",
  "user_preference",
  "task_observation",
  "external_claim",
  "policy_fact",
  "tooling_observation",
  "policy_lesson",
  "skill_candidate"
]);

export const MemoryStatusSchema = z.enum([
  "quarantined",
  "verified",
  "rejected",
  "expired"
]);

export const RepositoryStatusSchema = z.enum(["active", "archived"]);

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

export const PolicyDecisionRecordSchema = z.object({
  id: z.string().min(1),
  actionId: z.string().min(1),
  policyId: z.string().min(1),
  decision: PolicyDecisionValueSchema,
  risk: PolicyRiskSchema,
  ruleId: z.string().min(1).optional(),
  reason: z.string().min(1),
  obligations: z.array(z.string().min(1)),
  action: JsonObjectSchema,
  result: JsonObjectSchema,
  createdAt: z.string().min(1)
});

export type PolicyDecisionRecord = z.infer<typeof PolicyDecisionRecordSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  policyDecisionId: z.string().min(1),
  actionId: z.string().min(1),
  status: ApprovalStatusSchema,
  risk: PolicyRiskSchema,
  reason: z.string().min(1),
  requestedBy: z.string().min(1).optional(),
  expiresAt: z.string().min(1).optional(),
  decidedAt: z.string().min(1).optional(),
  decidedBy: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const WorkerRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  workerType: z.string().min(1),
  status: WorkerRunStatusSchema,
  enforcementLevel: z.string().min(1),
  checkpointBefore: z.string().min(1).optional(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  output: JsonObjectSchema.optional()
});

export type WorkerRun = z.infer<typeof WorkerRunSchema>;
export type WorkerRunStatus = z.infer<typeof WorkerRunStatusSchema>;

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  workerRunId: z.string().min(1),
  taskId: z.string().min(1),
  actionType: z.string().min(1),
  status: ToolCallStatusSchema,
  policyDecisionId: z.string().min(1).optional(),
  input: JsonObjectSchema,
  output: JsonObjectSchema.optional(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional()
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1),
  type: MemoryTypeSchema,
  status: MemoryStatusSchema,
  confidence: z.number().min(0).max(1),
  content: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)),
  provenance: JsonObjectSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  conflictsWith: z.array(z.string().min(1))
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const RepositoryRecordSchema = z.object({
  id: z.string().min(1),
  alias: z.string().min(1),
  localPath: z.string().min(1),
  remoteUrl: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
  status: RepositoryStatusSchema,
  tags: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type RepositoryRecord = z.infer<typeof RepositoryRecordSchema>;
export type RepositoryStatus = z.infer<typeof RepositoryStatusSchema>;

export const RunsteadEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  payload: JsonObjectSchema,
  createdAt: z.string().min(1)
});

export type RunsteadEvent = z.infer<typeof RunsteadEventSchema>;
