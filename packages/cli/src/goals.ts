import { join, resolve } from "node:path";

import { createRunsteadId, type Goal, type RunsteadEvent } from "@runstead/core";
import { loadDomainPackBundleFromDir } from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { inspectGitRepository } from "./repo-inspection.js";
import { resolveRepositoryReference } from "./repositories.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { buildGeneratedGoalTasks } from "./goals-generated-tasks.js";
import { goalScope } from "./goals-scope.js";
import type { CreateGoalOptions, CreateGoalResult } from "./goals-types.js";

export { listGoals, showGoal } from "./goals-read.js";
export type {
  CreateGoalOptions,
  CreateGoalResult,
  ListGoalsOptions,
  ListGoalsResult,
  ShowGoalOptions,
  ShowGoalResult
} from "./goals-types.js";

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
