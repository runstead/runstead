import { resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { listGoals } from "./goals.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import {
  createLocalAgentTask,
  runLocalAgentTask,
  type LocalAgentWorkerKind,
  type RunLocalAgentTaskOptions,
  type RunLocalAgentTaskResult
} from "./local-agent.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  jsonStringArray,
  prioritizedBlockers,
  remediationGuidance,
  remediationNextCommands,
  uniqueBlockers
} from "./startup-remediation-guidance.js";
import {
  addStartupEvidence,
  checkStartupGate,
  type StartupGateFindingSeverity,
  type StartupGateStage
} from "./startup-evidence.js";
import { listTasks } from "./tasks.js";
import type { WorkerProcessRunner } from "./wrapped-worker.js";

export interface GenerateStartupRemediationPlanOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  now?: Date;
}

export interface StartupRemediationTaskSummary {
  task: Task;
  blocker: string;
  reused: boolean;
  severity: StartupGateFindingSeverity;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export interface GenerateStartupRemediationPlanResult {
  root: string;
  stateDb: string;
  domain: string;
  stage: StartupGateStage;
  status: "clear" | "blocked";
  blockers: string[];
  reportPath?: string;
  tasks: StartupRemediationTaskSummary[];
  plan: StartupRemediationPlanGraph;
  nextCommands: string[];
}

export interface ExecuteStartupRemediationPlanOptions extends GenerateStartupRemediationPlanOptions {
  worker?: LocalAgentWorkerKind;
  model?: string;
  workerRunner?: WorkerProcessRunner;
  onWorkerProgress?: RunLocalAgentTaskOptions["onWorkerProgress"];
  workerProgressIntervalMs?: number;
  maxTasks?: number;
}

export interface StartupRemediationExecutionSummary {
  remediationTaskId: string;
  localAgentTaskId: string;
  blocker: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  resolved: boolean;
  remainingBlockers: string[];
  gateEventId: string;
  failureEvidenceId?: string;
}

export interface StartupRemediationPlanGraph {
  nodes: StartupRemediationPlanNode[];
  edges: StartupRemediationPlanEdge[];
  budget: StartupRemediationBudget;
}

export interface StartupRemediationPlanNode {
  taskId: string;
  blocker: string;
  severity: StartupGateFindingSeverity;
  acceptanceCriteria: string[];
}

export interface StartupRemediationPlanEdge {
  fromTaskId: string;
  toTaskId: string;
  reason: string;
}

export interface StartupRemediationBudget {
  maxTasks?: number;
  selectedTasks: number;
  skippedTasks: number;
}

export interface ExecuteStartupRemediationPlanResult extends GenerateStartupRemediationPlanResult {
  worker: LocalAgentWorkerKind;
  executed: StartupRemediationExecutionSummary[];
  finalGate: {
    passed: boolean;
    blockers: string[];
    warnings: string[];
    eventId: string;
  };
  executionOutcome: "clear" | "partial" | "blocked";
  budget: StartupRemediationBudget;
  finalReportPath?: string;
}

export interface SupersedeStartupRemediationTasksOptions {
  cwd?: string;
  domain?: string;
  stage?: StartupGateStage;
  activeBlockers?: string[];
  runId: string;
  now?: Date;
}

export interface SupersedeStartupRemediationTasksResult {
  root: string;
  stateDb: string;
  supersededTasks: Task[];
}

const STARTUP_DOMAIN = "ai-native-startup";
const REMEDIATION_TASK_TYPE = "startup_remediation";

export {
  formatStartupRemediationExecution,
  formatStartupRemediationPlan
} from "./startup-remediation-format.js";

export async function generateStartupRemediationPlan(
  options: GenerateStartupRemediationPlanOptions = {}
): Promise<GenerateStartupRemediationPlanResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const report =
    stage === "launch"
      ? await generateLaunchReadinessReport({ cwd, domain, now })
      : undefined;
  const gate = await checkStartupGate({ cwd, domain, stage, now });
  const blockers = prioritizedBlockers(
    uniqueBlockers([...(report?.blockers ?? []), ...gate.blockers])
  );
  const goal = activeStartupGoal({ cwd, domain });
  const existingTasks = listTasks({ cwd }).tasks.filter(
    (task) => task.domain === domain && task.type === REMEDIATION_TASK_TYPE
  );
  const createdTasks: StartupRemediationTaskSummary[] = [];
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    for (const blocker of blockers) {
      const existing = reusableRemediationTask(existingTasks, stage, blocker);

      if (existing !== undefined) {
        createdTasks.push(
          remediationTaskSummary({
            task: existing,
            blocker,
            reused: true,
            gate
          })
        );
        continue;
      }

      const task = buildRemediationTask({
        goal,
        stage,
        blocker,
        createdAt,
        ...(report?.reportPath === undefined ? {} : { reportPath: report.reportPath })
      });
      const event = taskCreatedEvent(task, blocker, createdAt);

      appendEventAndProject(database, {
        event,
        projection: {
          type: "task",
          value: task
        }
      });
      existingTasks.push(task);
      createdTasks.push(
        remediationTaskSummary({
          task,
          blocker,
          reused: false,
          gate
        })
      );
    }
  } finally {
    database.close();
  }
  const plannedTasks = withRemediationDependencies(createdTasks);

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    domain,
    stage,
    status: blockers.length === 0 ? "clear" : "blocked",
    blockers,
    ...(report?.reportPath === undefined ? {} : { reportPath: report.reportPath }),
    tasks: plannedTasks,
    plan: remediationPlanGraph(plannedTasks),
    nextCommands: remediationNextCommands(stage)
  };
}

export async function executeStartupRemediationPlan(
  options: ExecuteStartupRemediationPlanOptions = {}
): Promise<ExecuteStartupRemediationPlanResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const worker = options.worker ?? "codex_cli";
  const plan = await generateStartupRemediationPlan({
    cwd,
    domain,
    stage,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const executionTargets =
    options.maxTasks === undefined ? plan.tasks : plan.tasks.slice(0, options.maxTasks);
  const executed: StartupRemediationExecutionSummary[] = [];
  const budget: StartupRemediationBudget = {
    ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
    selectedTasks: executionTargets.length,
    skippedTasks: Math.max(0, plan.tasks.length - executionTargets.length)
  };

  for (const item of executionTargets) {
    const execution = await executeRemediationTask({
      cwd,
      domain,
      stage,
      worker,
      item,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.workerRunner === undefined
        ? {}
        : { workerRunner: options.workerRunner }),
      ...(options.workerProgressIntervalMs === undefined
        ? {}
        : { workerProgressIntervalMs: options.workerProgressIntervalMs }),
      ...(options.onWorkerProgress === undefined
        ? {}
        : { onWorkerProgress: options.onWorkerProgress }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    executed.push(execution);
  }

  const finalGate = await checkStartupGate({
    cwd,
    domain,
    stage,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const finalReport =
    stage === "launch"
      ? await generateLaunchReadinessReport({
          cwd,
          domain,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

  return {
    ...plan,
    status: finalGate.passed ? "clear" : "blocked",
    blockers: finalGate.blockers,
    worker,
    executed,
    finalGate: {
      passed: finalGate.passed,
      blockers: finalGate.blockers,
      warnings: finalGate.warnings,
      eventId: finalGate.event.eventId
    },
    executionOutcome: remediationExecutionOutcome(finalGate.passed, executed),
    budget,
    ...(finalReport?.reportPath === undefined
      ? {}
      : { finalReportPath: finalReport.reportPath })
  };
}

export async function supersedeStartupRemediationTasks(
  options: SupersedeStartupRemediationTasksOptions
): Promise<SupersedeStartupRemediationTasksResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const stage = options.stage ?? "launch";
  const activeBlockers = new Set(options.activeBlockers ?? []);
  const updatedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const tasks = listTasks({ cwd }).tasks.filter(
    (task) =>
      task.domain === domain &&
      task.type === REMEDIATION_TASK_TYPE &&
      task.input.stage === stage &&
      !terminalRemediationTaskStatuses().has(task.status) &&
      !activeBlockers.has(stringValue(task.input.blocker))
  );
  const database = openRunsteadDatabase(resolvedState.stateDb);
  const supersededTasks: Task[] = [];

  try {
    for (const task of tasks) {
      const superseded: Task = {
        ...task,
        status: "cancelled",
        output: {
          ...task.output,
          superseded: {
            byRunId: options.runId,
            reason:
              activeBlockers.size === 0
                ? "latest startup readiness verdict has no active blockers"
                : "startup readiness blocker is no longer active",
            activeBlockers: [...activeBlockers]
          }
        },
        updatedAt
      };

      appendEventAndProject(database, {
        event: {
          eventId: createRunsteadId("evt"),
          type: "task.superseded",
          aggregateType: "task",
          aggregateId: task.id,
          payload: superseded.output ?? {},
          createdAt: updatedAt
        },
        projection: {
          type: "task",
          value: superseded
        }
      });
      supersededTasks.push(superseded);
    }
  } finally {
    database.close();
  }

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    supersededTasks
  };
}

async function executeRemediationTask(input: {
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

function remediationWorkerPrompt(item: StartupRemediationTaskSummary): string {
  return [
    "Resolve the Runstead startup readiness blocker below.",
    "",
    `Blocker: ${item.blocker}`,
    `Stage: ${String(item.task.input.stage)}`,
    `Scope: ${String(item.task.input.scope)}`,
    `Expected evidence: ${jsonStringArray(item.task.input.expectedEvidence).join(", ")}`,
    `Acceptance criteria: ${item.acceptanceCriteria.join("; ")}`,
    `Depends on: ${item.dependsOn.length === 0 ? "none" : item.dependsOn.join(", ")}`,
    `Verifier: ${String(item.task.input.verifier)}`,
    "",
    "After implementation, record or refresh the relevant Runstead startup evidence and leave the repo in a verifier-ready state.",
    "Do not push, publish, or change unrelated product scope."
  ].join("\n");
}

async function recordRemediationExecution(input: {
  cwd: string;
  task: Task;
  execution: StartupRemediationExecutionSummary;
  now?: Date;
}): Promise<void> {
  const resolvedState = await requireRunsteadStateDb(input.cwd);
  const updatedAt = (input.now ?? new Date()).toISOString();
  const status = remediationTaskStatus(input.execution);
  const task: Task = {
    ...input.task,
    status,
    attempt: input.task.attempt + 1,
    output: {
      ...input.task.output,
      execution: {
        localAgentTaskId: input.execution.localAgentTaskId,
        status: input.execution.status,
        summary: input.execution.summary,
        resolved: input.execution.resolved,
        remainingBlockers: input.execution.remainingBlockers,
        gateEventId: input.execution.gateEventId
      }
    },
    updatedAt
  };
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    appendEventAndProject(database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: "task.remediation_executed",
        aggregateType: "task",
        aggregateId: task.id,
        payload: task.output ?? {},
        createdAt: updatedAt
      },
      projection: {
        type: "task",
        value: task
      }
    });
  } finally {
    database.close();
  }
}

function remediationTaskStatus(
  execution: StartupRemediationExecutionSummary
): Task["status"] {
  if (execution.status === "waiting_approval") {
    return "waiting_approval";
  }

  if (execution.status === "failed" || execution.status === "blocked") {
    return execution.status;
  }

  return execution.resolved ? "completed" : "blocked";
}

function remediationTaskSummary(input: {
  task: Task;
  blocker: string;
  reused: boolean;
  gate: Awaited<ReturnType<typeof checkStartupGate>>;
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

function withRemediationDependencies(
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

function remediationPlanGraph(
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

function remediationExecutionOutcome(
  finalGatePassed: boolean,
  executed: StartupRemediationExecutionSummary[]
): "clear" | "partial" | "blocked" {
  if (finalGatePassed) {
    return "clear";
  }

  return executed.some((item) => item.resolved) ? "partial" : "blocked";
}

async function recordRemediationFailureEvidence(input: {
  cwd: string;
  stage: StartupGateStage;
  blocker: string;
  localAgentTaskId: string;
  status: RunLocalAgentTaskResult["status"];
  summary: string;
  remainingBlockers: string[];
  now?: Date;
}): Promise<Awaited<ReturnType<typeof addStartupEvidence>>> {
  return addStartupEvidence({
    cwd: input.cwd,
    type: "remediation_failure",
    summary: `Remediation unresolved: ${input.blocker}`,
    gate: input.stage,
    blocker: input.blocker,
    content: JSON.stringify(
      {
        localAgentTaskId: input.localAgentTaskId,
        status: input.status,
        summary: input.summary,
        remainingBlockers: input.remainingBlockers,
        nextAction: "review blocker evidence or rerun remediation with tighter scope"
      },
      null,
      2
    ),
    ...(input.now === undefined ? {} : { now: input.now })
  });
}

function activeStartupGoal(input: { cwd: string; domain: string }): Goal {
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

function reusableRemediationTask(
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

function terminalRemediationTaskStatuses(): Set<Task["status"]> {
  return new Set(["completed", "cancelled"]);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildRemediationTask(input: {
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

function taskCreatedEvent(
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
