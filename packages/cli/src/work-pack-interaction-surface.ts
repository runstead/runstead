import type {
  WorkPack,
  WorkPackEntrypoint,
  WorkPackRuntimeCapability,
  WorkPackRuntimeEnvironment
} from "@runstead/domain-packs";

export type WorkPackInteractionKind =
  | "approval"
  | "evidence"
  | "scheduled_check"
  | "webhook_intake";

export type WorkPackInteractionStatus =
  | "implemented"
  | "modeled"
  | "missing_entrypoint"
  | "missing_runtime_capability";

export interface WorkPackInteractionSurfaceItem {
  kind: WorkPackInteractionKind;
  status: WorkPackInteractionStatus;
  entrypoint?: string;
  environment?: string;
  reason: string;
}

export interface WorkPackInteractionSurfaceReport {
  interactions: WorkPackInteractionSurfaceItem[];
}

interface InteractionRequirement {
  kind: WorkPackInteractionKind;
  capability: WorkPackRuntimeCapability;
  preferredEntrypointKinds: WorkPackEntrypoint["kind"][];
}

const INTERACTION_REQUIREMENTS: InteractionRequirement[] = [
  {
    kind: "approval",
    capability: "approvals",
    preferredEntrypointKinds: ["cli", "dashboard", "operator_api", "gateway"]
  },
  {
    kind: "evidence",
    capability: "evidence_writes",
    preferredEntrypointKinds: [
      "cli",
      "dashboard",
      "operator_api",
      "schedule",
      "gateway"
    ]
  },
  {
    kind: "scheduled_check",
    capability: "scheduled_checks",
    preferredEntrypointKinds: ["schedule"]
  },
  {
    kind: "webhook_intake",
    capability: "webhook_intake",
    preferredEntrypointKinds: ["gateway"]
  }
];

export function evaluateWorkPackInteractionSurface(
  workPack: WorkPack
): WorkPackInteractionSurfaceReport {
  const environments = new Map(
    workPack.runtimeEnvironments.map((environment) => [environment.id, environment])
  );

  return {
    interactions: INTERACTION_REQUIREMENTS.map((requirement) =>
      evaluateInteraction({
        requirement,
        entrypoints: workPack.entrypoints,
        environments
      })
    )
  };
}

function evaluateInteraction(input: {
  requirement: InteractionRequirement;
  entrypoints: WorkPackEntrypoint[];
  environments: Map<string, WorkPackRuntimeEnvironment>;
}): WorkPackInteractionSurfaceItem {
  const candidates = input.entrypoints.filter(
    (entrypoint) =>
      entrypoint.accepts.includes(input.requirement.capability) &&
      input.requirement.preferredEntrypointKinds.includes(entrypoint.kind)
  );
  const withEnvironment = candidates
    .map((entrypoint) => ({
      entrypoint,
      environment: input.environments.get(entrypoint.environment)
    }))
    .filter(
      (
        candidate
      ): candidate is {
        entrypoint: WorkPackEntrypoint;
        environment: WorkPackRuntimeEnvironment;
      } => candidate.environment !== undefined
    );
  const capable = withEnvironment.filter((candidate) =>
    candidate.environment.capabilities.includes(input.requirement.capability)
  );
  const selected =
    capable.find((candidate) => candidate.entrypoint.status === "implemented") ??
    capable[0];

  if (selected !== undefined) {
    return {
      kind: input.requirement.kind,
      status: selected.entrypoint.status,
      entrypoint: selected.entrypoint.id,
      environment: selected.environment.id,
      reason: `${selected.entrypoint.id} accepts ${input.requirement.capability} on ${selected.environment.id}`
    };
  }

  const firstCandidate = candidates[0];

  if (firstCandidate !== undefined) {
    return {
      kind: input.requirement.kind,
      status: "missing_runtime_capability",
      entrypoint: firstCandidate.id,
      environment: firstCandidate.environment,
      reason: `${firstCandidate.environment} does not declare ${input.requirement.capability}`
    };
  }

  return {
    kind: input.requirement.kind,
    status: "missing_entrypoint",
    reason: `no entrypoint accepts ${input.requirement.capability}`
  };
}
