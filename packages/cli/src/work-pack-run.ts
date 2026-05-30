import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import {
  domainPackRegistryEntryToWorkPack,
  loadDomainPackBundleFromDir,
  resolveDomainPackRef,
  type DomainPackRegistryEntry,
  type WorkPack,
  type WorkPackWorkflow
} from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { installDomainPack } from "./domain-pack-install.js";
import { createGoal } from "./goals.js";
import { buildGeneratedGoalTasks } from "./goals-generated-tasks.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { inspectGitRepository } from "./repo-inspection.js";
import { runQueuedTaskUnlocked } from "./run.js";
import type { RunOnceOptions, RunOnceResult } from "./run-types.js";
import { requireRunsteadStateDb, resolveRunsteadRootSync } from "./runstead-root.js";
import {
  evaluateWorkPackConnectorReadiness,
  type WorkPackConnectorReadiness
} from "./work-pack-connector-readiness.js";
import {
  evaluateWorkPackEvidenceContract,
  type WorkPackEvidenceContractVerdict
} from "./work-pack-evidence-contract.js";
import {
  evaluateWorkPackExtensionReadiness,
  type WorkPackExtensionReadinessReport
} from "./work-pack-extension-readiness.js";

export interface ResolveWorkPackWorkflowRunOptions {
  pack: string;
  workflow: string;
  cwd?: string;
  roots?: string[];
  includeBuiltIns?: boolean;
  connectorEnv?: Record<string, string | undefined>;
  extensionEnv?: Record<string, string | undefined>;
}

export interface WorkPackWorkflowRunPlan {
  entry: DomainPackRegistryEntry;
  workPack: WorkPack;
  workflow: WorkPackWorkflow;
  evidenceContract?: {
    workflow: string;
    outputs: string[];
    completionCriteria: string[];
    evaluators?: {
      requirement: string;
      description?: string;
      evidenceTypes: string[];
      taskTypes: string[];
      taskStatuses: string[];
      eventTypes: string[];
      match: "any" | "all";
    }[];
  };
  connectorReadiness: WorkPackConnectorReadiness[];
  extensionReadiness: WorkPackExtensionReadinessReport;
  suggestedCommands: string[];
}

export interface QueueWorkPackWorkflowRunOptions extends ResolveWorkPackWorkflowRunOptions {
  title?: string;
  now?: Date;
}

export interface ExecuteWorkPackWorkflowRunOptions
  extends QueueWorkPackWorkflowRunOptions, Omit<RunOnceOptions, "cwd" | "now"> {
  maxTasks?: number;
}

export interface QueuedWorkPackWorkflowRun {
  plan: WorkPackWorkflowRunPlan;
  goal: Goal;
  tasks: Task[];
  events: RunsteadEvent[];
  installedPack: boolean;
  stateDb: string;
}

export type ExecutedWorkPackWorkflowRunStatus =
  | "completed"
  | "partial"
  | "queued"
  | "blocked"
  | "waiting_approval"
  | "failed";

export interface ExecutedWorkPackWorkflowRun {
  queued: QueuedWorkPackWorkflowRun;
  taskResults: RunOnceResult[];
  status: ExecutedWorkPackWorkflowRunStatus;
  evidenceVerdict: WorkPackEvidenceContractVerdict;
  executedTaskCount: number;
}

export async function resolveWorkPackWorkflowRun(
  options: ResolveWorkPackWorkflowRunOptions
): Promise<WorkPackWorkflowRunPlan> {
  const roots = [...(options.roots ?? [])];
  const cwd = options.cwd ?? process.cwd();
  const workspaceDomainRoot = join(resolveRunsteadRootSync(cwd).root, "domains");

  roots.push(workspaceDomainRoot);

  const entry = await resolveDomainPackRef(options.pack, {
    roots,
    ...(options.includeBuiltIns === undefined
      ? { includeBuiltIns: !workspacePackExists(workspaceDomainRoot, options.pack) }
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const workPack = domainPackRegistryEntryToWorkPack(entry);
  const workflow = workPack.workflows.find(
    (candidate) => candidate.id === options.workflow
  );

  if (workflow === undefined) {
    throw new Error(
      `Workflow ${options.workflow} is not declared by pack ${entry.id}. Expected one of: ${workPack.workflows
        .map((candidate) => candidate.id)
        .join(", ")}`
    );
  }

  const evidenceContract = entry.domain.evidenceContracts?.find(
    (contract) => contract.workflow === options.workflow
  );
  const domainEvaluators = domainEvidenceRequirementEvaluators(entry.domain);
  const evidenceContractEvaluators = evidenceContractRequirements(
    evidenceContract
  ).flatMap((requirement) =>
    domainEvaluators.filter((evaluator) => evaluator.requirement === requirement)
  );

  const extensionReadiness = await evaluateWorkPackExtensionReadiness({
    cwd,
    domain: entry.id,
    components: workPack.extensions,
    ...(options.extensionEnv === undefined ? {} : { env: options.extensionEnv })
  });

  return {
    entry,
    workPack,
    workflow,
    ...(evidenceContract === undefined
      ? {}
      : {
          evidenceContract: {
            ...evidenceContract,
            ...(evidenceContractEvaluators.length === 0
              ? {}
              : { evaluators: evidenceContractEvaluators })
          }
        }),
    connectorReadiness: evaluateWorkPackConnectorReadiness({
      domain: entry.id,
      evidenceRequirements: evidenceContractRequirements(evidenceContract),
      ...(options.connectorEnv === undefined ? {} : { env: options.connectorEnv })
    }),
    extensionReadiness,
    suggestedCommands: suggestedCommandsForWorkflow({
      pack: entry.id,
      workflow: options.workflow,
      cwd
    })
  };
}

function domainEvidenceRequirementEvaluators(
  domain: DomainPackRegistryEntry["domain"]
): {
  requirement: string;
  description?: string;
  evidenceTypes: string[];
  taskTypes: string[];
  taskStatuses: string[];
  eventTypes: string[];
  match: "any" | "all";
}[] {
  const value = (
    domain as DomainPackRegistryEntry["domain"] & {
      evidenceRequirementEvaluators?: {
        requirement: string;
        description?: string;
        evidenceTypes: string[];
        taskTypes: string[];
        taskStatuses: string[];
        eventTypes: string[];
        match: "any" | "all";
      }[];
    }
  ).evidenceRequirementEvaluators;

  return value ?? [];
}

function evidenceContractRequirements(
  contract: WorkPackWorkflowRunPlan["evidenceContract"] | undefined
): string[] {
  if (contract === undefined) {
    return [];
  }

  return [...contract.outputs, ...contract.completionCriteria];
}

export async function queueWorkPackWorkflowRun(
  options: QueueWorkPackWorkflowRunOptions
): Promise<QueuedWorkPackWorkflowRun> {
  const cwd = options.cwd ?? process.cwd();
  const plan = await resolveWorkPackWorkflowRun(options);
  const installed = await ensureWorkPackInstalled({
    cwd,
    entry: plan.entry,
    ...(options.roots === undefined ? {} : { roots: options.roots }),
    ...(options.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: options.includeBuiltIns })
  });
  const queued =
    plan.workflow.kind === "goal_template"
      ? await queueGoalTemplateWorkflow({
          cwd,
          pack: plan.entry.id,
          workflow: plan.workflow.id,
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : await queueTaskTypeWorkflow({
          cwd,
          installedRoot: installed.root,
          workflow: plan.workflow.id,
          ...(options.title === undefined ? {} : { title: options.title }),
          ...(options.now === undefined ? {} : { now: options.now })
        });

  return {
    plan,
    ...queued,
    installedPack: installed.installed,
    stateDb: installed.stateDb
  };
}

export async function executeWorkPackWorkflowRun(
  options: ExecuteWorkPackWorkflowRunOptions
): Promise<ExecutedWorkPackWorkflowRun> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, () =>
    executeWorkPackWorkflowRunUnlocked(cwd, options)
  );
}

export async function executeWorkPackWorkflowRunUnlocked(
  cwd: string,
  options: ExecuteWorkPackWorkflowRunOptions
): Promise<ExecutedWorkPackWorkflowRun> {
  const queued = await queueWorkPackWorkflowRun({
    ...options,
    cwd
  });
  const maxTasks = Math.max(0, options.maxTasks ?? queued.tasks.length);
  const taskResults: RunOnceResult[] = [];

  for (const task of queued.tasks.slice(0, maxTasks)) {
    const result = await runQueuedTaskUnlocked(cwd, task, options);

    taskResults.push(result);

    if (!result.ranTask || result.task.status !== "completed") {
      break;
    }
  }
  const evidenceVerdict = evaluateWorkPackEvidenceContract({
    stateDb: queued.stateDb,
    ...(queued.plan.evidenceContract === undefined
      ? {}
      : { contract: queued.plan.evidenceContract }),
    goal: queued.goal,
    tasks: queued.tasks,
    taskResults
  });

  return {
    queued,
    taskResults,
    status: workPackWorkflowExecutionStatus({
      taskResults,
      taskCount: queued.tasks.length
    }),
    evidenceVerdict,
    executedTaskCount: taskResults.filter((result) => result.ranTask).length
  };
}

export function formatWorkPackWorkflowRunPlan(plan: WorkPackWorkflowRunPlan): string {
  const capabilityPolicy = plan.entry.domain.capabilityPolicy;

  return [
    "Runstead work pack run",
    `Pack: ${plan.workPack.id}`,
    `Name: ${plan.workPack.name}`,
    `Workflow: ${plan.workflow.id}`,
    `Workflow kind: ${plan.workflow.kind}`,
    `Source: ${plan.entry.source}`,
    `Root: ${plan.entry.root}`,
    `Capability reads: ${formatList(capabilityPolicy?.reads ?? [])}`,
    `Capability writes: ${formatList(capabilityPolicy?.writes ?? [])}`,
    `Capability approvals: ${formatList(capabilityPolicy?.approvalsRequired ?? [])}`,
    `Capability denied: ${formatList(capabilityPolicy?.denied ?? [])}`,
    `Evidence outputs: ${formatList(plan.evidenceContract?.outputs ?? [])}`,
    `Completion criteria: ${formatList(plan.evidenceContract?.completionCriteria ?? [])}`,
    `Connectors: ${formatConnectorReadiness(plan.connectorReadiness)}`,
    `Extensions: ${formatExtensionReadiness(plan.extensionReadiness)}`,
    `Suggested commands: ${formatList(plan.suggestedCommands)}`
  ].join("\n");
}

export function formatExecutedWorkPackWorkflowRun(
  result: ExecutedWorkPackWorkflowRun
): string {
  const contract = result.queued.plan.evidenceContract;
  const lines = [
    "Runstead work pack run",
    `Pack: ${result.queued.plan.workPack.id}`,
    `Workflow: ${result.queued.plan.workflow.id}`,
    `Status: ${result.status}`,
    `Installed pack: ${result.queued.installedPack ? "yes" : "no"}`,
    `Goal: ${result.queued.goal.id} (${result.queued.goal.title})`,
    `Tasks: ${result.executedTaskCount}/${result.queued.tasks.length}`,
    `Evidence contract: ${result.evidenceVerdict.status}`,
    `Evidence outputs: ${formatList(contract?.outputs ?? [])}`,
    `Completion criteria: ${formatList(contract?.completionCriteria ?? [])}`,
    `Satisfied outputs: ${satisfiedCount(result.evidenceVerdict.outputs)}/${result.evidenceVerdict.outputs.length}`,
    `Satisfied criteria: ${satisfiedCount(result.evidenceVerdict.completionCriteria)}/${result.evidenceVerdict.completionCriteria.length}`,
    `Connectors: ${formatConnectorReadiness(result.queued.plan.connectorReadiness)}`,
    `Extensions: ${formatExtensionReadiness(result.queued.plan.extensionReadiness)}`,
    "Executed tasks:"
  ];

  if (result.taskResults.length === 0) {
    lines.push("- 0");
  } else {
    for (const taskResult of result.taskResults) {
      lines.push(formatExecutedTaskLine(taskResult));
    }
  }

  appendMissingEvidenceLines(lines, result.evidenceVerdict);

  return lines.join("\n");
}

export function executedWorkPackWorkflowRunExitCode(
  result: ExecutedWorkPackWorkflowRun
): number {
  if (result.status !== "completed") {
    return 1;
  }

  return result.evidenceVerdict.status === "incomplete" ? 1 : 0;
}

function suggestedCommandsForWorkflow(input: {
  pack: string;
  workflow: string;
  cwd: string;
}): string[] {
  if (input.pack === "ai-native-startup" && input.workflow === "build-mvp") {
    return [
      `runstead startup ready --cwd ${input.cwd} --stage launch --target local --worker codex_cli --governance readiness`
    ];
  }

  if (input.pack === "repo-maintenance") {
    return [`runstead run --once --cwd ${input.cwd}`];
  }

  return [`runstead domain show ${input.pack} --cwd ${input.cwd}`];
}

async function ensureWorkPackInstalled(input: {
  cwd: string;
  entry: DomainPackRegistryEntry;
  roots?: string[];
  includeBuiltIns?: boolean;
}): Promise<{ root: string; installed: boolean; stateDb: string }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const installedRoot = join(state.root, "domains", input.entry.id);

  if (existsSync(join(installedRoot, "domain.yaml"))) {
    return {
      root: installedRoot,
      installed: false,
      stateDb: state.stateDb
    };
  }

  const result = await installDomainPack({
    cwd: input.cwd,
    ref: input.entry.root,
    ...(input.roots === undefined ? {} : { roots: input.roots }),
    ...(input.includeBuiltIns === undefined
      ? {}
      : { includeBuiltIns: input.includeBuiltIns })
  });

  return {
    root: result.destination,
    installed: true,
    stateDb: state.stateDb
  };
}

async function queueGoalTemplateWorkflow(input: {
  cwd: string;
  pack: string;
  workflow: string;
  title?: string;
  now?: Date;
}): Promise<{ goal: Goal; tasks: Task[]; events: RunsteadEvent[] }> {
  const created = await createGoal({
    cwd: input.cwd,
    domain: input.pack,
    template: input.workflow,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    goal: created.goal,
    tasks: created.generatedTasks,
    events: [created.event, ...created.generatedEvents]
  };
}

async function queueTaskTypeWorkflow(input: {
  cwd: string;
  installedRoot: string;
  workflow: string;
  title?: string;
  now?: Date;
}): Promise<{ goal: Goal; tasks: Task[]; events: RunsteadEvent[] }> {
  const state = await requireRunsteadStateDb(input.cwd);
  const bundle = await loadDomainPackBundleFromDir(input.installedRoot);
  const taskType = bundle.taskTypes.find(
    (candidate) => candidate.id === input.workflow
  );

  if (taskType === undefined) {
    throw new Error(
      `Task type ${input.workflow} was not found in domain pack ${bundle.domain.id}`
    );
  }

  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const git = await inspectGitRepository(input.cwd);
  const repositoryPath = git.root ?? input.cwd;
  const goal: Goal = {
    id: createRunsteadId("goal"),
    domain: bundle.domain.id,
    title: input.title ?? `Run ${taskType.id}`,
    status: "active",
    priority: taskType.defaultPriority,
    scope: {
      repositoryPath,
      workflowId: input.workflow,
      taskType: taskType.id,
      recurringTasks: [taskType.id],
      acceptanceContracts: taskType.verifiers.required
    },
    policyRef: bundle.domain.defaultPolicy,
    acceptanceRef: input.workflow,
    createdAt,
    updatedAt: createdAt
  };
  const goalEvent: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "goal.created",
    aggregateType: "goal",
    aggregateId: goal.id,
    payload: {
      domain: goal.domain,
      title: goal.title,
      workflowId: input.workflow,
      repositoryPath
    },
    createdAt
  };
  const generated = await buildGeneratedGoalTasks({
    cwd: repositoryPath,
    goal,
    bundle,
    taskTypeIds: [taskType.id],
    now
  });
  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, {
      event: goalEvent,
      projection: {
        type: "goal",
        value: goal
      }
    });

    for (const item of generated) {
      appendEventAndProject(database, {
        event: item.event,
        projection: {
          type: "task",
          value: item.task
        }
      });
    }
  } finally {
    database.close();
  }

  return {
    goal,
    tasks: generated.map((item) => item.task),
    events: [goalEvent, ...generated.map((item) => item.event)]
  };
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "0";
  }

  return `${values.length} (${values.join(", ")})`;
}

function formatConnectorReadiness(readiness: WorkPackConnectorReadiness[]): string {
  if (readiness.length === 0) {
    return "0";
  }

  return `${readiness.length} (${readiness
    .map((connector) => `${connector.connector}:${connector.status}`)
    .join(", ")})`;
}

function formatExtensionReadiness(report: WorkPackExtensionReadinessReport): string {
  const issueSuffix =
    report.issues.length === 0 ? "" : `; issues=${report.issues.length}`;

  if (report.readiness.length === 0) {
    return `0${issueSuffix}`;
  }

  return `${report.readiness.length} (${report.readiness
    .map((extension) => `${extension.extension}:${extension.status}`)
    .join(", ")})${issueSuffix}`;
}

function workPackWorkflowExecutionStatus(input: {
  taskResults: RunOnceResult[];
  taskCount: number;
}): ExecutedWorkPackWorkflowRunStatus {
  const lastTask = lastExecutedTask(input.taskResults);

  if (lastTask === undefined) {
    return "queued";
  }

  if (lastTask.status === "failed") {
    return "failed";
  }

  if (lastTask.status === "blocked") {
    return "blocked";
  }

  if (lastTask.status === "waiting_approval") {
    return "waiting_approval";
  }

  if (lastTask.status === "completed" && input.taskResults.length >= input.taskCount) {
    return "completed";
  }

  return "partial";
}

function lastExecutedTask(taskResults: RunOnceResult[]): Task | undefined {
  for (const result of taskResults.toReversed()) {
    if (result.ranTask) {
      return result.task;
    }
  }

  return undefined;
}

function formatExecutedTaskLine(result: RunOnceResult): string {
  if (!result.ranTask) {
    return `- idle: ${result.reason}`;
  }

  return `- ${result.task.type} ${result.task.id}: ${result.task.status}`;
}

function satisfiedCount(verdicts: WorkPackEvidenceContractVerdict["outputs"]): number {
  return verdicts.filter((verdict) => verdict.satisfied).length;
}

function appendMissingEvidenceLines(
  lines: string[],
  verdict: WorkPackEvidenceContractVerdict
): void {
  const missingOutputs = verdict.outputs.filter((item) => !item.satisfied);
  const missingCriteria = verdict.completionCriteria.filter((item) => !item.satisfied);

  if (missingOutputs.length > 0) {
    lines.push("Missing outputs:");
    for (const item of missingOutputs) {
      lines.push(`- ${item.id}: ${item.reason}`);
    }
  }

  if (missingCriteria.length > 0) {
    lines.push("Missing criteria:");
    for (const item of missingCriteria) {
      lines.push(`- ${item.id}: ${item.reason}`);
    }
  }
}

function workspacePackExists(root: string, ref: string): boolean {
  if (ref.startsWith(".") || ref.startsWith("/") || ref.includes("/")) {
    return false;
  }

  return existsSync(join(root, ref, "domain.yaml"));
}
