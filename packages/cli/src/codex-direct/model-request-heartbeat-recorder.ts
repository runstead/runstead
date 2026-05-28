import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CodexDirectModelRequestPhase } from "./worker-types.js";
import { recordModelRequestHeartbeat } from "./model-request-audit.js";

export interface CodexDirectModelRequestHeartbeatRecorder {
  record: (stage: "started" | "waiting") => void;
  count: () => number;
}

export function createModelRequestHeartbeatRecorder(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  timeoutMs: number;
  startedAt: number;
}): CodexDirectModelRequestHeartbeatRecorder {
  let heartbeatCount = 0;

  return {
    record: (stage) => {
      heartbeatCount += 1;
      recordModelRequestHeartbeat({
        database: input.database,
        task: input.task,
        workerRun: input.workerRun,
        sequence: heartbeatCount,
        stage,
        phase: input.phase,
        elapsedMs: Date.now() - input.startedAt,
        timeoutMs: input.timeoutMs
      });
    },
    count: () => heartbeatCount
  };
}
