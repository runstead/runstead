import type { Task, WorkerRun } from "@runstead/core";
import type { ReadinessTarget } from "@runstead/runtime";
import type { RunsteadEvidenceCollector } from "@runstead/sdk";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { runGovernedToolAction } from "./governed-action.js";
import type { PolicyProfile } from "./policy.js";
import type { StartupGateStage } from "./startup-evidence.js";
import {
  recordExtensionCollectorEvidence,
  runExtensionCollectorCommand
} from "./startup-extension-collector-evidence.js";
import { extensionCollectorAction } from "./startup-extension-collector-task.js";
import type { StartupExtensionCollectorExecutionResult } from "./startup-extension-collector-types.js";
import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

const EXTENSION_COLLECTOR_TIMEOUT_MS = 30_000;

export async function runStartupExtensionCollector(input: {
  cwd: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  runningTask: Task;
  workerRun: WorkerRun;
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
