import type { Task } from "@runstead/core";

import type { StartupGateCheckResult } from "./startup-evidence.js";
import {
  jsonStringArray,
  remediationGuidance
} from "./startup-remediation-guidance.js";
import type {
  StartupRemediationPlanGraph,
  StartupRemediationTaskSummary
} from "./startup-remediation-types.js";

export function remediationTaskSummary(input: {
  task: Task;
  blocker: string;
  reused: boolean;
  gate: StartupGateCheckResult;
}): StartupRemediationTaskSummary {
  const finding = input.gate.findings.find((item) => item.message === input.blocker);
  const guidance = remediationGuidance(input.blocker);

  return {
    task: input.task,
    blocker: input.blocker,
    reused: input.reused,
    severity: finding?.severity ?? "major",
    acceptanceCriteria: jsonStringArray(input.task.input.acceptanceCriteria).length
      ? jsonStringArray(input.task.input.acceptanceCriteria)
      : guidance.acceptanceCriteria,
    dependsOn: []
  };
}

export function withRemediationDependencies(
  tasks: StartupRemediationTaskSummary[]
): StartupRemediationTaskSummary[] {
  const sorted = [...tasks].sort(
    (a, b) =>
      remediationGuidance(a.blocker).order - remediationGuidance(b.blocker).order
  );

  return sorted.map((item, index) => ({
    ...item,
    dependsOn: sorted.slice(0, index).map((previous) => previous.task.id)
  }));
}

export function remediationPlanGraph(
  tasks: StartupRemediationTaskSummary[]
): StartupRemediationPlanGraph {
  return {
    nodes: tasks.map((item) => ({
      taskId: item.task.id,
      blocker: item.blocker,
      severity: item.severity,
      acceptanceCriteria: item.acceptanceCriteria
    })),
    edges: tasks.flatMap((item) =>
      item.dependsOn.map((dependency) => ({
        fromTaskId: dependency,
        toTaskId: item.task.id,
        reason: "resolve earlier launch-readiness dependency first"
      }))
    ),
    budget: {
      selectedTasks: tasks.length,
      skippedTasks: 0
    }
  };
}
