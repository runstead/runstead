import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";

import { listGoals } from "./goals.js";
import type { StartupGateStage } from "./startup-evidence.js";
import {
  remediationGuidance,
  remediationNextCommands
} from "./startup-remediation-guidance.js";

export const REMEDIATION_TASK_TYPE = "startup_remediation";

export function activeStartupGoal(input: { cwd: string; domain: string }): Goal {
  const goals = listGoals({ cwd: input.cwd }).goals.filter(
    (goal) => goal.domain === input.domain
  );
  const activeGoal =
    goals.find((goal) => goal.status === "active") ??
    goals.find((goal) => goal.status !== "completed");

  if (activeGoal === undefined) {
    throw new Error(
      `Startup remediation requires an ${input.domain} goal. Run startup init first.`
    );
  }

  return activeGoal;
}

export function reusableRemediationTask(
  tasks: Task[],
  stage: StartupGateStage,
  blocker: string
): Task | undefined {
  return tasks.find(
    (task) =>
      !terminalRemediationTaskStatuses().has(task.status) &&
      task.input.stage === stage &&
      task.input.blocker === blocker
  );
}

export function terminalRemediationTaskStatuses(): Set<Task["status"]> {
  return new Set(["completed", "cancelled"]);
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function buildRemediationTask(input: {
  goal: Goal;
  stage: StartupGateStage;
  blocker: string;
  createdAt: string;
  reportPath?: string;
}): Task {
  const guidance = remediationGuidance(input.blocker);
  const taskInput: JsonObject = {
    stage: input.stage,
    blocker: input.blocker,
    scope: guidance.scope,
    policyRef: input.goal.policyRef ?? "domain:ai-native-startup/default",
    workerCandidates: ["codex_cli", "claude_code"],
    verifier: guidance.verifier,
    expectedEvidence: guidance.expectedEvidence,
    acceptanceCriteria: guidance.acceptanceCriteria,
    completionEvidence: [
      "diff_ref",
      "checkpoint_ref",
      "verifier_evidence_id",
      "updated_gate_event_id",
      "updated_report_path"
    ],
    afterExecutionCommands: remediationNextCommands(input.stage),
    ...(input.reportPath === undefined ? {} : { reportPath: input.reportPath })
  };

  return {
    id: createRunsteadId("task"),
    goalId: input.goal.id,
    domain: input.goal.domain,
    type: REMEDIATION_TASK_TYPE,
    status: "queued",
    priority: "high",
    attempt: 0,
    maxAttempts: 2,
    input: taskInput,
    verifiers: guidance.verifiers,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

export function taskCreatedEvent(
  task: Task,
  blocker: string,
  createdAt: string
): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    payload: {
      goalId: task.goalId,
      type: task.type,
      blocker,
      stage: task.input.stage,
      verifier: task.input.verifier,
      expectedEvidence: task.input.expectedEvidence
    },
    createdAt
  };
}
