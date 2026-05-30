import { existsSync } from "node:fs";
import { join } from "node:path";

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
import { inspectGitRepository } from "./repo-inspection.js";
import { requireRunsteadStateDb, resolveRunsteadRootSync } from "./runstead-root.js";

export interface ResolveWorkPackWorkflowRunOptions {
  pack: string;
  workflow: string;
  cwd?: string;
  roots?: string[];
  includeBuiltIns?: boolean;
}

export interface WorkPackWorkflowRunPlan {
  entry: DomainPackRegistryEntry;
  workPack: WorkPack;
  workflow: WorkPackWorkflow;
  evidenceContract?: {
    workflow: string;
    outputs: string[];
    completionCriteria: string[];
  };
  suggestedCommands: string[];
}

export interface QueueWorkPackWorkflowRunOptions
  extends ResolveWorkPackWorkflowRunOptions {
  title?: string;
  now?: Date;
}

export interface QueuedWorkPackWorkflowRun {
  plan: WorkPackWorkflowRunPlan;
  goal: Goal;
  tasks: Task[];
  events: RunsteadEvent[];
  installedPack: boolean;
  stateDb: string;
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

  return {
    entry,
    workPack,
    workflow,
    ...(evidenceContract === undefined ? {} : { evidenceContract }),
    suggestedCommands: suggestedCommandsForWorkflow({
      pack: entry.id,
      workflow: options.workflow,
      cwd
    })
  };
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

export function formatWorkPackWorkflowRunPlan(
  plan: WorkPackWorkflowRunPlan
): string {
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
    `Suggested commands: ${formatList(plan.suggestedCommands)}`
  ].join("\n");
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

  return [
    `runstead domain show ${input.pack} --cwd ${input.cwd}`
  ];
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
  const taskType = bundle.taskTypes.find((candidate) => candidate.id === input.workflow);

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

function workspacePackExists(root: string, ref: string): boolean {
  if (ref.startsWith(".") || ref.startsWith("/") || ref.includes("/")) {
    return false;
  }

  return existsSync(join(root, ref, "domain.yaml"));
}
