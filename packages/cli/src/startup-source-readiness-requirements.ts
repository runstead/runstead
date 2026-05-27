import {
  runtimeStartupSourceConnectorReadinessEvidenceRequirements,
  runtimeStartupSourceConnectorRequirementBlockers,
  runtimeStartupSourceConnectorRequirementsForTarget,
  type ReadinessEvidenceRequirement,
  type RuntimeStartupSourceConnectorReadinessRequirement
} from "@runstead/runtime";

import type {
  StartupSourceConnector,
  StartupSourceTarget
} from "./startup-source-connector-definitions.js";

export type StartupSourceConnectorReadinessRequirement =
  RuntimeStartupSourceConnectorReadinessRequirement & {
    target: StartupSourceTarget;
    connectors: StartupSourceConnector[];
  };

export function startupSourceConnectorRequirementsForTarget(options: {
  target: StartupSourceTarget;
  env?: Record<string, string | undefined>;
}): StartupSourceConnectorReadinessRequirement[] {
  return runtimeStartupSourceConnectorRequirementsForTarget({
    target: options.target,
    env: options.env ?? process.env
  }) as StartupSourceConnectorReadinessRequirement[];
}

export function startupSourceConnectorReadinessEvidenceRequirements(
  requirements: StartupSourceConnectorReadinessRequirement[]
): ReadinessEvidenceRequirement[] {
  return runtimeStartupSourceConnectorReadinessEvidenceRequirements(requirements);
}

export function startupSourceConnectorRequirementBlockers(
  requirements: StartupSourceConnectorReadinessRequirement[]
): string[] {
  return runtimeStartupSourceConnectorRequirementBlockers(requirements);
}
