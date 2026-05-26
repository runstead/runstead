import {
  createLocalAgentTask,
  runLocalAgentTask,
  type LocalAgentWorkerKind,
  type RunLocalAgentTaskOptions
} from "./local-agent.js";
import { checkStartupGate, type StartupGateStage } from "./startup-evidence.js";
import {
  recordRemediationExecution,
  recordRemediationFailureEvidence,
  remediationWorkerPrompt
} from "./startup-remediation-execution.js";
import type {
  StartupRemediationExecutionSummary,
  StartupRemediationTaskSummary
} from "./startup-remediation-types.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export async function executeRemediationTask(input: {
  cwd: string;
  domain: string;
  stage: StartupGateStage;
  worker: LocalAgentWorkerKind;
  item: StartupRemediationTaskSummary;
  model?: string;
  workerRunner?: WorkerProcessRunner;
  onWorkerProgress?: RunLocalAgentTaskOptions["onWorkerProgress"];
  workerProgressIntervalMs?: number;
  now?: Date;
}): Promise<StartupRemediationExecutionSummary> {
  const created = await createLocalAgentTask({
    cwd: input.cwd,
    title: `Remediate startup blocker: ${input.item.blocker}`,
    prompt: remediationWorkerPrompt(input.item),
    worker: input.worker,
    mode: "repair",
    checkpoint: true,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const run = await runLocalAgentTask({
    cwd: input.cwd,
    taskId: created.task.id,
    ...(input.workerRunner === undefined ? {} : { workerRunner: input.workerRunner }),
    ...(input.workerProgressIntervalMs === undefined
      ? {}
      : { workerProgressIntervalMs: input.workerProgressIntervalMs }),
    ...(input.onWorkerProgress === undefined
      ? {}
      : { onWorkerProgress: input.onWorkerProgress }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const gate = await checkStartupGate({
    cwd: input.cwd,
    domain: input.domain,
    stage: input.stage,
    ...(input.now === undefined ? {} : { now: input.now })
  });
  const resolved = !gate.blockers.includes(input.item.blocker);
  const failureEvidence =
    resolved && run.status === "completed"
      ? undefined
      : await recordRemediationFailureEvidence({
          cwd: input.cwd,
          stage: input.stage,
          blocker: input.item.blocker,
          localAgentTaskId: created.task.id,
          status: run.status,
          summary: run.summary,
          remainingBlockers: gate.blockers,
          ...(input.now === undefined ? {} : { now: input.now })
        });
  const execution: StartupRemediationExecutionSummary = {
    remediationTaskId: input.item.task.id,
    localAgentTaskId: created.task.id,
    blocker: input.item.blocker,
    status: run.status,
    summary: run.summary,
    resolved,
    remainingBlockers: gate.blockers,
    gateEventId: gate.event.eventId,
    ...(failureEvidence === undefined
      ? {}
      : { failureEvidenceId: failureEvidence.evidence.id })
  };

  await recordRemediationExecution({
    cwd: input.cwd,
    task: input.item.task,
    execution,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return execution;
}
