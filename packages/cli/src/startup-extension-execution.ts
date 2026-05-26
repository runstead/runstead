import { resolve } from "node:path";

import type { ReadinessTarget } from "@runstead/runtime";

import { type LocalAgentWorkerKind } from "./local-agent.js";
import { type StartupGateStage } from "./startup-evidence.js";
import {
  runStartupExtensionCollectors,
  startupExtensionCollectorsForTarget,
  type StartupExtensionCollectorExecutionResult
} from "./startup-extension-collector-runner.js";
import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers
} from "./startup-extension-loader.js";
import type { ResolvedStartupWorkerGovernanceProfile } from "./startup-founder-flow.js";

export interface StartupExtensionExecutionResult {
  status: "passed" | "blocked";
  loaded: string[];
  artifacts: string[];
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
  collectorResults: StartupExtensionCollectorExecutionResult[];
}

export type { StartupExtensionCollectorExecutionResult };

interface StartupExtensionCollectorExecutionInput {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  worker: LocalAgentWorkerKind;
  governanceProfile: ResolvedStartupWorkerGovernanceProfile;
  now?: Date;
}

export async function executeStartupReadinessExtensions(
  input: StartupExtensionCollectorExecutionInput
): Promise<StartupExtensionExecutionResult> {
  const cwd = resolve(input.cwd);
  const loaded = await loadStartupReadinessExtensions({ cwd });
  const requirements = startupReadinessExtensionEvidenceRequirements(
    loaded.extensions,
    { stage: input.stage }
  );
  const policyBlockers = startupReadinessExtensionPolicyBlockers({
    extensions: loaded.extensions,
    requirements,
    target: input.target,
    worker: input.worker,
    governanceProfile: input.governanceProfile
  });
  const collectorInputs = startupExtensionCollectorsForTarget({
    extensions: loaded.extensions,
    requirements,
    target: input.target
  });

  if (loaded.issues.length > 0 || policyBlockers.length > 0) {
    return {
      status: "blocked",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: [],
      blockers: [...loaded.issues, ...policyBlockers],
      warnings: [],
      collectorResults: []
    };
  }

  if (collectorInputs.length === 0) {
    return {
      status: "passed",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: [],
      blockers: [],
      warnings:
        loaded.extensions.length === 0
          ? []
          : ["no executable extension collectors were required for this target"],
      collectorResults: []
    };
  }

  const collectorResults = await runStartupExtensionCollectors({
    cwd,
    target: input.target,
    stage: input.stage,
    worker: input.worker,
    collectorInputs,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const blocked = collectorResults.flatMap((result) => result.blockers);

  return {
    status: blocked.length === 0 ? "passed" : "blocked",
    loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
    artifacts: loaded.discoveredPaths,
    evidenceIds: collectorResults.flatMap((result) => result.evidenceIds),
    blockers: blocked,
    warnings: collectorResults.flatMap((result) => result.warnings),
    collectorResults
  };
}
