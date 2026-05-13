import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type Goal,
  type JsonObject,
  type RunsteadEvent
} from "@runstead/core";
import { loadDomainPackBundleFromDir } from "@runstead/domain-packs";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { inspectGitRepository } from "./repo-inspection.js";

export interface CreateGoalOptions {
  cwd?: string;
  domain: string;
  template?: string;
  title?: string;
  now?: Date;
}

export interface CreateGoalResult {
  goal: Goal;
  event: RunsteadEvent;
  stateDb: string;
}

export async function createGoal(
  options: CreateGoalOptions
): Promise<CreateGoalResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = join(cwd, ".runstead");
  const stateDb = join(root, "state.db");
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

  const now = (options.now ?? new Date()).toISOString();
  const git = await inspectGitRepository(cwd);
  const goal: Goal = {
    id: createRunsteadId("goal"),
    domain: bundle.domain.id,
    title: options.title ?? template.title,
    status: "active",
    priority: "medium",
    scope: goalScope({
      repositoryPath: git.root ?? cwd,
      templateId: template.id,
      recurringTasks: template.generated.recurringTasks,
      acceptanceContracts: template.generated.acceptanceContracts
    }),
    policyRef: bundle.domain.defaultPolicy,
    createdAt: now,
    updatedAt: now
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
      repositoryPath: git.root ?? cwd
    },
    createdAt: now
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, {
      event,
      projection: {
        type: "goal",
        value: goal
      }
    });
  } finally {
    database.close();
  }

  return {
    goal,
    event,
    stateDb
  };
}

function goalScope(input: {
  repositoryPath: string;
  templateId: string;
  recurringTasks: string[];
  acceptanceContracts: string[];
}): JsonObject {
  return {
    repositoryPath: input.repositoryPath,
    templateId: input.templateId,
    recurringTasks: input.recurringTasks,
    acceptanceContracts: input.acceptanceContracts
  };
}
