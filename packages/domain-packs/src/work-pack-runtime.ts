import { z } from "zod";

import type { WorkPackWorkflow } from "./work-pack.js";

export const WorkPackRuntimeEnvironmentKindSchema = z.enum([
  "local",
  "ci",
  "team_control_plane",
  "remote_runner"
]);

export const WorkPackRuntimeBackendSchema = z.enum(["sqlite", "postgres", "external"]);

export const WorkPackRuntimeCapabilitySchema = z.enum([
  "approvals",
  "evidence_writes",
  "scheduled_checks",
  "webhook_intake",
  "runner_heartbeat",
  "artifact_store"
]);

export const WorkPackEntrypointKindSchema = z.enum([
  "cli",
  "ci",
  "dashboard",
  "operator_api",
  "schedule",
  "gateway"
]);

export const WorkPackEntrypointStatusSchema = z.enum(["implemented", "modeled"]);

export const WorkPackRuntimeEnvironmentSchema = z.object({
  id: z.string().min(1),
  kind: WorkPackRuntimeEnvironmentKindSchema,
  backend: WorkPackRuntimeBackendSchema,
  label: z.string().min(1).optional(),
  workers: z.array(z.string().min(1)).default([]),
  capabilities: z.array(WorkPackRuntimeCapabilitySchema).default([])
});

export const WorkPackEntrypointSchema = z.object({
  id: z.string().min(1),
  kind: WorkPackEntrypointKindSchema,
  status: WorkPackEntrypointStatusSchema,
  environment: z.string().min(1),
  workflows: z.array(z.string().min(1)).default([]),
  label: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  accepts: z.array(WorkPackRuntimeCapabilitySchema).default([])
});

export type WorkPackRuntimeEnvironmentKind = z.infer<
  typeof WorkPackRuntimeEnvironmentKindSchema
>;
export type WorkPackRuntimeBackend = z.infer<typeof WorkPackRuntimeBackendSchema>;
export type WorkPackRuntimeCapability = z.infer<typeof WorkPackRuntimeCapabilitySchema>;
export type WorkPackEntrypointKind = z.infer<typeof WorkPackEntrypointKindSchema>;
export type WorkPackEntrypointStatus = z.infer<typeof WorkPackEntrypointStatusSchema>;
export type WorkPackRuntimeEnvironment = z.infer<
  typeof WorkPackRuntimeEnvironmentSchema
>;
export type WorkPackEntrypoint = z.infer<typeof WorkPackEntrypointSchema>;

export function defaultWorkPackRuntimeEnvironments(
  supportedWorkers: string[]
): WorkPackRuntimeEnvironment[] {
  const workers = uniqueNonEmpty(supportedWorkers);

  return [
    {
      id: "local",
      kind: "local",
      backend: "sqlite",
      label: "Local workstation",
      workers,
      capabilities: ["approvals", "evidence_writes", "artifact_store"]
    },
    {
      id: "ci",
      kind: "ci",
      backend: "sqlite",
      label: "CI runner",
      workers,
      capabilities: ["evidence_writes", "artifact_store"]
    },
    {
      id: "team-control-plane",
      kind: "team_control_plane",
      backend: "postgres",
      label: "Team control plane",
      workers,
      capabilities: [
        "approvals",
        "evidence_writes",
        "scheduled_checks",
        "webhook_intake",
        "runner_heartbeat",
        "artifact_store"
      ]
    }
  ].map((environment) => WorkPackRuntimeEnvironmentSchema.parse(environment));
}

export function defaultWorkPackEntrypoints(input: {
  pack: string;
  workflows: WorkPackWorkflow[];
}): WorkPackEntrypoint[] {
  const workflows = input.workflows.map((workflow) => workflow.id);

  return [
    {
      id: "cli-run",
      kind: "cli",
      status: "implemented",
      environment: "local",
      label: "CLI run",
      command: `runstead run ${input.pack} <workflow>`,
      workflows,
      accepts: ["approvals", "evidence_writes"]
    },
    {
      id: "ci-dispatch",
      kind: "ci",
      status: "modeled",
      environment: "ci",
      label: "CI dispatch",
      command: `runstead run ${input.pack} <workflow>`,
      workflows,
      accepts: ["evidence_writes"]
    },
    {
      id: "operator-api",
      kind: "operator_api",
      status: "modeled",
      environment: "team-control-plane",
      label: "Operator API",
      path: `/api/work-packs/${input.pack}/runs`,
      workflows,
      accepts: ["approvals", "evidence_writes"]
    },
    {
      id: "operator-dashboard",
      kind: "dashboard",
      status: "modeled",
      environment: "team-control-plane",
      label: "Operator dashboard",
      path: `/dashboard/work-packs/${input.pack}`,
      workflows,
      accepts: ["approvals", "evidence_writes"]
    },
    {
      id: "scheduled-check",
      kind: "schedule",
      status: "modeled",
      environment: "team-control-plane",
      label: "Scheduled check",
      path: `/api/work-packs/${input.pack}/schedules`,
      workflows,
      accepts: ["scheduled_checks", "evidence_writes"]
    },
    {
      id: "webhook-gateway",
      kind: "gateway",
      status: "modeled",
      environment: "team-control-plane",
      label: "Webhook gateway",
      path: `/webhooks/work-packs/${input.pack}`,
      workflows,
      accepts: ["webhook_intake", "approvals", "evidence_writes"]
    }
  ].map((entrypoint) => WorkPackEntrypointSchema.parse(entrypoint));
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
