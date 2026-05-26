import type { LocalAgentWorkerKind } from "./local-agent.js";

export type StartupWorkerGovernanceProfile = "auto" | "readiness" | "governed";
export type ResolvedStartupWorkerGovernanceProfile = Exclude<
  StartupWorkerGovernanceProfile,
  "auto"
>;

export interface ResolvedStartupWorkerGovernance {
  profile: ResolvedStartupWorkerGovernanceProfile;
  worker: LocalAgentWorkerKind;
}

export function formatStartupWorkerGovernanceNotice(
  worker: LocalAgentWorkerKind,
  profile: ResolvedStartupWorkerGovernanceProfile = worker === "codex_direct"
    ? "governed"
    : "readiness"
): string {
  if (worker === "codex_direct") {
    return `Worker governance: ${profile} profile; codex_direct uses Runstead's Level 2 native tool proxy path; model tool calls are governed inside Runstead.`;
  }

  return `Worker governance: ${profile} profile; ${worker} uses Runstead's Level 1 process wrapper path; worker launch, sandbox, checkpoints, diff scope, and post-run verifiers are governed, but worker-internal tool calls are not hard-proxied. Use --governance governed or --worker codex_direct when every model tool call must pass through Runstead policy and audit.`;
}

export function resolveStartupWorkerGovernance(input: {
  worker?: LocalAgentWorkerKind;
  target?: "local" | "staging" | "production";
  governanceProfile?: StartupWorkerGovernanceProfile;
}): ResolvedStartupWorkerGovernance {
  const profile = resolveStartupWorkerGovernanceProfile(input);
  const worker =
    input.worker ?? (profile === "governed" ? "codex_direct" : "codex_cli");

  if (profile === "governed" && worker !== "codex_direct") {
    throw new Error(
      `Governance profile governed requires --worker codex_direct; ${worker} is a Level 1 readiness wrapper without hard-proxied worker-internal tool calls`
    );
  }

  return {
    profile,
    worker
  };
}

function resolveStartupWorkerGovernanceProfile(input: {
  worker?: LocalAgentWorkerKind;
  target?: "local" | "staging" | "production";
  governanceProfile?: StartupWorkerGovernanceProfile;
}): ResolvedStartupWorkerGovernanceProfile {
  if (input.governanceProfile !== undefined && input.governanceProfile !== "auto") {
    return input.governanceProfile;
  }

  if (input.worker === "codex_direct") {
    return "governed";
  }

  return input.target === "production" ? "governed" : "readiness";
}
