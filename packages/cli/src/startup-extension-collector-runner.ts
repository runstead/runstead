import { join } from "node:path";

import type { ReadinessTarget } from "@runstead/runtime";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { type LocalAgentWorkerKind } from "./local-agent.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { type StartupGateStage } from "./startup-evidence.js";
import { runStartupExtensionCollector } from "./startup-extension-collector-executor.js";
import { startupExtensionCollectorPreflight } from "./startup-extension-collector-preflight.js";
import {
  createExtensionCollectorTask,
  finishExtensionCollectorTask,
  startExtensionCollectorTask
} from "./startup-extension-collector-task.js";
import type {
  StartupExtensionCollectorExecutionResult,
  StartupExtensionCollectorInput
} from "./startup-extension-collector-types.js";

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
