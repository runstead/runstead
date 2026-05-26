import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import type { ReadinessEvidenceRequirement, ReadinessTarget } from "@runstead/runtime";
import { type RunsteadEvidenceCollector } from "@runstead/sdk";

import { type LocalAgentWorkerKind } from "./local-agent.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { type StartupGateStage } from "./startup-evidence.js";
import {
  normalizeStartupExtensionEvidenceType,
  recordExtensionCollectorEvidence,
  runExtensionCollectorCommand
} from "./startup-extension-collector-evidence.js";
import {
  loadStartupReadinessExtensions,
  startupReadinessExtensionEvidenceRequirements,
  startupReadinessExtensionPolicyBlockers,
  type LoadedStartupReadinessExtension
} from "./startup-extension-loader.js";
import {
  createExtensionCollectorTask,
  extensionCollectorAction,
  finishExtensionCollectorTask,
  startExtensionCollectorTask
} from "./startup-extension-collector-task.js";
import type { ResolvedStartupWorkerGovernanceProfile } from "./startup-founder-flow.js";
import { runGovernedToolAction } from "./governed-action.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";

const EXTENSION_COLLECTOR_TIMEOUT_MS = 30_000;

export interface StartupExtensionExecutionResult {
  status: "passed" | "blocked";
  loaded: string[];
  artifacts: string[];
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
  collectorResults: StartupExtensionCollectorExecutionResult[];
}

export interface StartupExtensionCollectorExecutionResult {
  extensionId: string;
  collectorId: string;
  status: "passed" | "blocked" | "skipped";
  command?: string;
  evidenceIds: string[];
  blockers: string[];
  warnings: string[];
}

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

  const task = await createExtensionCollectorTask({
    cwd,
    worker: input.worker,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const state = await requireRunsteadStateDb(cwd);
  const database = openRunsteadDatabase(state.stateDb);
  const collectorResults: StartupExtensionCollectorExecutionResult[] = [];

  try {
    const runningTask = startExtensionCollectorTask(database, task, input.now);
    const workerRun = startWorkerRun({
      database,
      task: runningTask,
      workerType: "extension_collector",
      enforcementLevel: "policy_enforced",
      ...(input.now === undefined ? {} : { now: input.now })
    });
    const policy = await loadPolicyProfileFromFile(
      join(state.root, "policies", "repo-maintenance.yaml")
    );

    for (const collectorInput of collectorInputs) {
      const { extension, collector } = collectorInput;
      const missingSecrets = collector.requiredSecrets.filter(
        (secret) => process.env[secret] === undefined || process.env[secret] === ""
      );

      if (missingSecrets.length > 0) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "blocked",
          ...(collector.command === undefined ? {} : { command: collector.command }),
          evidenceIds: [],
          blockers: [
            `extension ${extension.contract.extensionId}/${collector.id} requires secrets: ${missingSecrets.join(", ")}`
          ],
          warnings: []
        });
        continue;
      }

      if (collector.command === undefined) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "skipped",
          evidenceIds: [],
          blockers: [],
          warnings: [
            `extension ${extension.contract.extensionId}/${collector.id} has no command execution contract`
          ]
        });
        continue;
      }

      try {
        const governed = await runGovernedToolAction({
          cwd,
          stateDb: state.stateDb,
          database,
          policy,
          task: runningTask,
          workerRun,
          action: extensionCollectorAction({
            task: runningTask,
            extensionId: extension.contract.extensionId,
            collector,
            cwd
          }),
          requestedBy: "runstead:extension-collector",
          ...(input.now === undefined ? {} : { now: input.now }),
          run: async () => {
            const command = await runExtensionCollectorCommand({
              cwd,
              command: collector.command ?? "",
              timeoutMs: EXTENSION_COLLECTOR_TIMEOUT_MS
            });
            const evidenceIds = await recordExtensionCollectorEvidence({
              cwd,
              target: input.target,
              stage: input.stage,
              extension,
              collector,
              stdout: command.stdout,
              ...(input.now === undefined ? {} : { now: input.now })
            });

            return {
              value: {
                command,
                evidenceIds
              },
              output: {
                exitCode: command.exitCode,
                evidenceIds
              }
            };
          }
        });

        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: governed.value.command.exitCode === 0 ? "passed" : "blocked",
          command: collector.command,
          evidenceIds: governed.value.evidenceIds,
          blockers:
            governed.value.command.exitCode === 0
              ? []
              : [
                  `extension ${extension.contract.extensionId}/${collector.id} collector exited ${governed.value.command.exitCode}`
                ],
          warnings:
            governed.value.command.stderr.trim().length === 0
              ? []
              : [governed.value.command.stderr.trim()]
        });
      } catch (error) {
        collectorResults.push({
          extensionId: extension.contract.extensionId,
          collectorId: collector.id,
          status: "blocked",
          command: collector.command,
          evidenceIds: [],
          blockers: [
            `extension ${extension.contract.extensionId}/${collector.id} collector failed: ${errorMessage(error)}`
          ],
          warnings: []
        });
      }
    }

    const blocked = collectorResults.flatMap((result) => result.blockers);

    finishWorkerRun({
      database,
      workerRun,
      status: blocked.length === 0 ? "completed" : "failed",
      output: {
        collectors: collectorResults.length,
        evidenceIds: collectorResults.flatMap((result) => result.evidenceIds),
        blockers: blocked
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishExtensionCollectorTask(database, runningTask, blocked, input.now);

    return {
      status: blocked.length === 0 ? "passed" : "blocked",
      loaded: loaded.extensions.map((extension) => extension.contract.extensionId),
      artifacts: loaded.discoveredPaths,
      evidenceIds: collectorResults.flatMap((result) => result.evidenceIds),
      blockers: blocked,
      warnings: collectorResults.flatMap((result) => result.warnings),
      collectorResults
    };
  } finally {
    database.close();
  }
}

function startupExtensionCollectorsForTarget(input: {
  extensions: LoadedStartupReadinessExtension[];
  requirements: ReadinessEvidenceRequirement[];
  target: ReadinessTarget;
}): {
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
}[] {
  const requiredTypes = new Set(
    input.requirements
      .filter((requirement) => requirement.targets.includes(input.target))
      .flatMap((requirement) =>
        requirement.evidenceTypes.map(normalizeStartupExtensionEvidenceType)
      )
  );

  return input.extensions.flatMap((extension) =>
    extension.contract.collectors
      .filter(
        (collector) =>
          collector.targets.includes(input.target) &&
          collector.producesEvidenceTypes
            .map(normalizeStartupExtensionEvidenceType)
            .some((type) => requiredTypes.has(type))
      )
      .map((collector) => ({ extension, collector }))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
