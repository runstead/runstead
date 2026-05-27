import { join } from "node:path";

import type { ReadinessTarget } from "@runstead/runtime";
import type { RunsteadEvidenceCollector } from "@runstead/sdk";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { runGovernedToolAction } from "./governed-action.js";
import { type LocalAgentWorkerKind } from "./local-agent.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { type StartupGateStage } from "./startup-evidence.js";
import {
  recordExtensionCollectorEvidence,
  runExtensionCollectorCommand
} from "./startup-extension-collector-evidence.js";
import { startupExtensionCollectorPreflight } from "./startup-extension-collector-preflight.js";
import {
  createExtensionCollectorTask,
  extensionCollectorAction,
  finishExtensionCollectorTask,
  startExtensionCollectorTask
} from "./startup-extension-collector-task.js";
import type {
  StartupExtensionCollectorExecutionResult,
  StartupExtensionCollectorInput
} from "./startup-extension-collector-types.js";
import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

const EXTENSION_COLLECTOR_TIMEOUT_MS = 30_000;

export async function runStartupExtensionCollectors(input: {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  worker: LocalAgentWorkerKind;
  collectorInputs: StartupExtensionCollectorInput[];
  now?: Date;
}): Promise<StartupExtensionCollectorExecutionResult[]> {
  const task = await createExtensionCollectorTask({
    cwd: input.cwd,
    worker: input.worker,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const state = await requireRunsteadStateDb(input.cwd);
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

    for (const collectorInput of input.collectorInputs) {
      const { extension, collector } = collectorInput;
      const preflight = startupExtensionCollectorPreflight(collectorInput);

      if (preflight !== undefined) {
        collectorResults.push(preflight);
        continue;
      }

      collectorResults.push(
        await runStartupExtensionCollector({
          cwd: input.cwd,
          stateDb: state.stateDb,
          database,
          policy,
          runningTask,
          workerRun,
          target: input.target,
          stage: input.stage,
          extension,
          collector,
          ...(input.now === undefined ? {} : { now: input.now })
        })
      );
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

    return collectorResults;
  } finally {
    database.close();
  }
}

async function runStartupExtensionCollector(input: {
  cwd: string;
  stateDb: string;
  database: ReturnType<typeof openRunsteadDatabase>;
  policy: Awaited<ReturnType<typeof loadPolicyProfileFromFile>>;
  runningTask: ReturnType<typeof startExtensionCollectorTask>;
  workerRun: ReturnType<typeof startWorkerRun>;
  target: ReadinessTarget;
  stage: StartupGateStage;
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
  now?: Date;
}): Promise<StartupExtensionCollectorExecutionResult> {
  const { extension, collector } = input;

  try {
    const governed = await runGovernedToolAction({
      cwd: input.cwd,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.runningTask,
      workerRun: input.workerRun,
      action: extensionCollectorAction({
        task: input.runningTask,
        extensionId: extension.contract.extensionId,
        collector,
        cwd: input.cwd
      }),
      requestedBy: "runstead:extension-collector",
      ...(input.now === undefined ? {} : { now: input.now }),
      run: async () => {
        const command = await runExtensionCollectorCommand({
          cwd: input.cwd,
          command: collector.command ?? "",
          timeoutMs: EXTENSION_COLLECTOR_TIMEOUT_MS
        });
        const evidenceIds = await recordExtensionCollectorEvidence({
          cwd: input.cwd,
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

    return {
      extensionId: extension.contract.extensionId,
      collectorId: collector.id,
      status: governed.value.command.exitCode === 0 ? "passed" : "blocked",
      ...(collector.command === undefined ? {} : { command: collector.command }),
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
    };
  } catch (error) {
    return {
      extensionId: extension.contract.extensionId,
      collectorId: collector.id,
      status: "blocked",
      ...(collector.command === undefined ? {} : { command: collector.command }),
      evidenceIds: [],
      blockers: [
        `extension ${extension.contract.extensionId}/${collector.id} collector failed: ${errorMessage(error)}`
      ],
      warnings: []
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
