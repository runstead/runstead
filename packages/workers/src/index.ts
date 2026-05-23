export const RUNSTEAD_WORKER_KINDS = [
  "codex_direct",
  "codex_cli",
  "claude_code"
] as const;

export type RunsteadWorkerKind = (typeof RUNSTEAD_WORKER_KINDS)[number];

export type WrappedRunsteadWorkerKind = Extract<
  RunsteadWorkerKind,
  "codex_cli" | "claude_code"
>;

export type NativeRunsteadWorkerKind = Extract<RunsteadWorkerKind, "codex_direct">;

export type WorkerGovernanceLevel = "governed_execution" | "readiness_wrapper";

export interface WorkerGovernanceCapability {
  worker: RunsteadWorkerKind;
  level: WorkerGovernanceLevel;
  hardProxyToolCalls: boolean;
  launchPolicyGate: boolean;
  workspaceCheckpoint: boolean;
  postRunVerifierEvidence: boolean;
}

export function listWorkerGovernanceCapabilities(): WorkerGovernanceCapability[] {
  return RUNSTEAD_WORKER_KINDS.map((worker) => workerGovernanceCapability(worker));
}

export function workerGovernanceCapability(
  worker: RunsteadWorkerKind
): WorkerGovernanceCapability {
  const hardProxyToolCalls = worker === "codex_direct";

  return {
    worker,
    level: hardProxyToolCalls ? "governed_execution" : "readiness_wrapper",
    hardProxyToolCalls,
    launchPolicyGate: true,
    workspaceCheckpoint: true,
    postRunVerifierEvidence: true
  };
}

export function isRunsteadWorkerKind(value: string): value is RunsteadWorkerKind {
  return RUNSTEAD_WORKER_KINDS.includes(value as RunsteadWorkerKind);
}
