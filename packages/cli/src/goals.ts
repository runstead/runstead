import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  GoalSchema,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import {
  type DomainPackBundle,
  loadDomainPackBundleFromDir
} from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { inspectGitRepository } from "./repo-inspection.js";
import { resolveRepositoryReference } from "./repositories.js";
import { requireRunsteadStateDb, requireRunsteadStateDbSync } from "./runstead-root.js";
import { buildDomainTask, buildRunLocalVerifiersTask } from "./tasks.js";

export interface CreateGoalOptions {
  cwd?: string;
  domain: string;
  template?: string;
  title?: string;
  repository?: string;
  now?: Date;
}

export interface CreateGoalResult {
  goal: Goal;
  event: RunsteadEvent;
  generatedTasks: Task[];
  generatedEvents: RunsteadEvent[];
  stateDb: string;
}

export interface ListGoalsOptions {
  cwd?: string;
}

export interface ListGoalsResult {
  goals: Goal[];
  stateDb: string;
}

export interface ShowGoalOptions {
  cwd?: string;
  id: string;
}

export interface ShowGoalResult {
  goal: Goal;
  stateDb: string;
}

export async function createGoal(
  options: CreateGoalOptions
): Promise<CreateGoalResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const root = resolvedState.root;
  const stateDb = resolvedState.stateDb;
  const registeredRepository =
    options.repository === undefined
      ? undefined
      : resolveRepositoryReference({
          cwd,
          ref: options.repository
        }).repository;
  const bundle = await loadDomainPackBundleFromDir(
    join(root, "domains", options.domain)
  );
  const template =
    bundle.goalTemplates.find((candidate) => candidate.id === options.template) ??
    bundle.goalTemplates[0];

  if (template === undefined) {
    throw new Error(`Domain pack ${options.domain} does not define goal templates`);
  }

  if (options.template !== undefined && template.id !== options.template) {
    throw new Error(
      `Goal template ${options.template} was not found in domain pack ${options.domain}`
    );
  }

  const now = options.now ?? new Date();
  const createdAt = now.toISOString();
  const repositoryPath = registeredRepository?.localPath ?? cwd;
  const git = await inspectGitRepository(repositoryPath);
  const resolvedRepositoryPath = git.root ?? repositoryPath;
  const goal: Goal = {
    id: createRunsteadId("goal"),
    domain: bundle.domain.id,
    title: options.title ?? template.title,
    status: "active",
    priority: "medium",
    scope: goalScope({
      repositoryPath: resolvedRepositoryPath,
      ...(registeredRepository === undefined
        ? {}
        : {
            repositoryId: registeredRepository.id,
            repositoryAlias: registeredRepository.alias
          }),
      templateId: template.id,
      recurringTasks: template.generated.recurringTasks,
      acceptanceContracts: template.generated.acceptanceContracts
    }),
    policyRef: bundle.domain.defaultPolicy,
    createdAt,
    updatedAt: createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "goal.created",
    aggregateType: "goal",
    aggregateId: goal.id,
    payload: {
      domain: goal.domain,
      title: goal.title,
      templateId: template.id,
      repositoryPath: resolvedRepositoryPath,
      ...(registeredRepository === undefined
        ? {}
        : {
            repositoryId: registeredRepository.id,
            repositoryAlias: registeredRepository.alias
          })
    },
    createdAt
  };
  const generated = await buildGeneratedGoalTasks({
    cwd: resolvedRepositoryPath,
    goal,
    bundle,
    taskTypeIds: template.generated.recurringTasks,
    now
  });
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
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
    event,
    generatedTasks: generated.map((item) => item.task),
    generatedEvents: generated.map((item) => item.event),
    stateDb
  };
}

export function listGoals(options: ListGoalsOptions = {}): ListGoalsResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const rows = database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, budget_json,
               policy_ref, acceptance_ref, created_at, updated_at
        FROM goals
        ORDER BY created_at DESC, id ASC
      `
      )
      .all() as unknown as GoalRow[];

    return {
      goals: rows.map(rowToGoal),
      stateDb
    };
  } finally {
    database.close();
  }
}

export function showGoal(options: ShowGoalOptions): ShowGoalResult {
  const stateDb = resolveStateDb(options.cwd);
  const database = openRunsteadDatabase(stateDb);

  try {
    const row = database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, budget_json,
               policy_ref, acceptance_ref, created_at, updated_at
        FROM goals
        WHERE id = ?
      `
      )
      .get(options.id) as GoalRow | undefined;

    if (row === undefined) {
      throw new Error(`Goal not found: ${options.id}`);
    }

    return {
      goal: rowToGoal(row),
      stateDb
    };
  } finally {
    database.close();
  }
}

async function buildGeneratedGoalTasks(input: {
  cwd: string;
  goal: Goal;
  bundle: DomainPackBundle;
  taskTypeIds: string[];
  now: Date;
}): Promise<{ task: Task; event: RunsteadEvent }[]> {
  const taskTypesById = new Map(
    input.bundle.taskTypes.map((taskType) => [taskType.id, taskType])
  );
  const generated: { task: Task; event: RunsteadEvent }[] = [];

  for (const taskTypeId of input.taskTypeIds) {
    if (taskTypeId === "run_local_verifiers") {
      generated.push(
        await buildRunLocalVerifiersTask({
          cwd: input.cwd,
          goal: input.goal,
          now: input.now
        })
      );
      continue;
    }

    const taskType = taskTypesById.get(taskTypeId);

    if (taskType === undefined) {
      throw new Error(
        `Goal template references unknown task type ${taskTypeId} in domain pack ${input.bundle.domain.id}`
      );
    }

    generated.push(
      buildDomainTask({
        cwd: input.cwd,
        goal: input.goal,
        taskType,
        now: input.now
      })
    );
  }

  return generated;
}

function goalScope(input: {
  repositoryPath: string;
  repositoryId?: string;
  repositoryAlias?: string;
  templateId: string;
  recurringTasks: string[];
  acceptanceContracts: string[];
}): JsonObject {
  return {
    repositoryPath: input.repositoryPath,
    ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
    ...(input.repositoryAlias === undefined
      ? {}
      : { repositoryAlias: input.repositoryAlias }),
    templateId: input.templateId,
    recurringTasks: input.recurringTasks,
    acceptanceContracts: input.acceptanceContracts
  };
}

function resolveStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}

interface GoalRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  scope_json: string;
  budget_json: string | null;
  policy_ref: string | null;
  acceptance_ref: string | null;
  created_at: string;
  updated_at: string;
}

function rowToGoal(row: GoalRow): Goal {
  return GoalSchema.parse({
    id: row.id,
    domain: row.domain,
    title: row.title,
    status: row.status,
    priority: row.priority,
    scope: JSON.parse(row.scope_json) as JsonObject,
    ...(row.budget_json === null
      ? {}
      : { budget: JSON.parse(row.budget_json) as JsonObject }),
    ...(row.policy_ref === null ? {} : { policyRef: row.policy_ref }),
    ...(row.acceptance_ref === null ? {} : { acceptanceRef: row.acceptance_ref }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}
