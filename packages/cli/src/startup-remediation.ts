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
import { checkStartupGate, type StartupGateStage } from "./startup-evidence.js";
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
  finalReportPath?: string;
}

const STARTUP_DOMAIN = "ai-native-startup";
const REMEDIATION_TASK_TYPE = "startup_remediation";

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
  const blockers = uniqueStrings([...(report?.blockers ?? []), ...gate.blockers]);
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
        createdTasks.push({ task: existing, blocker, reused: true });
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
      createdTasks.push({ task, blocker, reused: false });
    }
  } finally {
    database.close();
  }

  return {
    root: resolvedState.root,
    stateDb: resolvedState.stateDb,
    domain,
    stage,
    status: blockers.length === 0 ? "clear" : "blocked",
    blockers,
    ...(report?.reportPath === undefined ? {} : { reportPath: report.reportPath }),
    tasks: createdTasks,
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
    ...(finalReport?.reportPath === undefined
      ? {}
      : { finalReportPath: finalReport.reportPath })
  };
}

export function formatStartupRemediationPlan(
  result: GenerateStartupRemediationPlanResult
): string {
  return [
    `Startup remediation: ${result.stage}`,
    `Domain: ${result.domain}`,
    `Status: ${result.status}`,
    ...(result.reportPath === undefined ? [] : [`Report: ${result.reportPath}`]),
    "",
    "Blockers:",
    listOrNone(result.blockers, (blocker) => `- ${blocker}`),
    "",
    "Tasks:",
    listOrNone(
      result.tasks,
      (item) =>
        `- ${item.task.id} ${item.reused ? "(reused)" : "(created)"}: ${item.blocker}`
    ),
    "",
    "Next commands:",
    listOrNone(result.nextCommands, (command) => `- ${command}`)
  ].join("\n");
}

export function formatStartupRemediationExecution(
  result: ExecuteStartupRemediationPlanResult
): string {
  return [
    formatStartupRemediationPlan(result),
    "",
    "Execution:",
    `- Worker: ${result.worker}`,
    listOrNone(
      result.executed,
      (item) =>
        `- ${item.remediationTaskId} -> ${item.localAgentTaskId}: ${item.status}; resolved=${item.resolved ? "yes" : "no"}; remaining=${item.remainingBlockers.length}`
    ),
    "",
    "Final gate:",
    `- Status: ${result.finalGate.passed ? "passed" : "blocked"}`,
    `- Event: ${result.finalGate.eventId}`,
    listOrNone(result.finalGate.blockers, (blocker) => `- blocker: ${blocker}`),
    ...(result.finalReportPath === undefined
      ? []
      : ["", `Final report: ${result.finalReportPath}`])
  ].join("\n");
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
  const execution: StartupRemediationExecutionSummary = {
    remediationTaskId: input.item.task.id,
    localAgentTaskId: created.task.id,
    blocker: input.item.blocker,
    status: run.status,
    summary: run.summary,
    resolved,
    remainingBlockers: gate.blockers,
    gateEventId: gate.event.eventId
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
      task.status !== "completed" &&
      task.input.stage === stage &&
      task.input.blocker === blocker
  );
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

function remediationGuidance(blocker: string): {
  scope: string;
  verifier: string;
  verifiers: string[];
  expectedEvidence: string[];
} {
  const normalized = blocker.toLowerCase();

  if (normalized.includes("measurement") || normalized.includes("metric")) {
    return {
      scope:
        "Define or attach launch metric evidence with source, threshold, current value, and snapshot date.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_metric", "command:startup_gate_check"],
      expectedEvidence: ["startup_metric", "startup_measurement_framework"]
    };
  }

  if (normalized.includes("verifier") || normalized.includes("command_output")) {
    return {
      scope:
        "Run the MVP verifier task after the latest product change and attach passing command_output evidence.",
      verifier: "runstead verifier run <task-id>",
      verifiers: ["evidence:command_output", "command:startup_gate_check"],
      expectedEvidence: ["command_output"]
    };
  }

  if (normalized.includes("security")) {
    return {
      scope:
        "Produce or refresh the launch security baseline and remediate any high-risk findings.",
      verifier: "runstead startup launch security-baseline",
      verifiers: ["evidence:startup_security_baseline", "command:startup_gate_check"],
      expectedEvidence: ["startup_security_baseline"]
    };
  }

  if (normalized.includes("repo") || normalized.includes("ci")) {
    return {
      scope:
        "Fix repository readiness gaps such as missing scripts, CI, or launch-critical hygiene.",
      verifier: "runstead startup launch audit",
      verifiers: ["evidence:startup_repo_readiness", "command:startup_gate_check"],
      expectedEvidence: ["startup_repo_readiness"]
    };
  }

  if (normalized.includes("migration")) {
    return {
      scope:
        "Record migration owner, remediation task, and acceptance criteria for this launch.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_migration_plan", "command:startup_gate_check"],
      expectedEvidence: ["startup_migration_plan"]
    };
  }

  if (normalized.includes("rollback")) {
    return {
      scope:
        "Record rollback owner, remediation task, and acceptance criteria for this launch.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_rollback_plan", "command:startup_gate_check"],
      expectedEvidence: ["startup_rollback_plan"]
    };
  }

  if (normalized.includes("observability")) {
    return {
      scope:
        "Record launch observability owner, remediation task, alert surface, and acceptance criteria.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_observability", "command:startup_gate_check"],
      expectedEvidence: ["startup_observability"]
    };
  }

  if (normalized.includes("founder") || normalized.includes("bottleneck")) {
    return {
      scope:
        "Map founder-only launch knowledge to an owner, system of record, and handoff acceptance check.",
      verifier: "runstead startup launch bottleneck-map",
      verifiers: ["evidence:startup_founder_bottleneck", "command:startup_gate_check"],
      expectedEvidence: ["startup_founder_bottleneck"]
    };
  }

  if (normalized.includes("accepted debt")) {
    return {
      scope: "Attach an explicit decision record before accepting launch debt.",
      verifier: "runstead startup gate check --stage launch",
      verifiers: ["evidence:startup_decision", "command:startup_gate_check"],
      expectedEvidence: ["startup_decision", "startup_acceptable_debt"]
    };
  }

  return {
    scope: `Resolve launch readiness blocker: ${blocker}`,
    verifier: "runstead startup gate check --stage launch",
    verifiers: ["command:startup_gate_check"],
    expectedEvidence: ["startup_evidence"]
  };
}

function remediationNextCommands(stage: StartupGateStage): string[] {
  return stage === "launch"
    ? ["runstead startup gate check --stage launch", "runstead startup launch report"]
    : [`runstead startup gate check --stage ${stage}`];
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
