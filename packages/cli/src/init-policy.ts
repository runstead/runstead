import { repoMaintenancePolicyYaml } from "./init-policy-yaml.js";

export type InitPolicyProfile = "default" | "trusted-local";

const INIT_POLICY_PROFILES: InitPolicyProfile[] = ["default", "trusted-local"];
const DEFAULT_POLICY = repoMaintenancePolicyYaml("default");
const TRUSTED_LOCAL_POLICY = repoMaintenancePolicyYaml("trusted-local");

export function policyYamlForProfile(profile: InitPolicyProfile): string {
  return profile === "trusted-local" ? TRUSTED_LOCAL_POLICY : DEFAULT_POLICY;
}

export function resolveInitPolicyProfile(
  profile: InitPolicyProfile | undefined
): InitPolicyProfile {
  if (profile === undefined) {
    return "default";
  }

  if (INIT_POLICY_PROFILES.includes(profile)) {
    return profile;
  }

  throw new Error(`Unsupported init profile: ${profile}`);
}
