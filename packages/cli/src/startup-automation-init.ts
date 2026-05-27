import { join, resolve } from "node:path";

import type { Goal } from "@runstead/core";

import { installDomainPack, upgradeDomainPack } from "./domain-pack-install.js";
import { createGoal, listGoals } from "./goals.js";
import { initRunstead, type InitPolicyProfile } from "./init.js";
import { resolveRunsteadRoot, requireRunsteadStateDb } from "./runstead-root.js";
import {
  type StartupInitOptions,
  type StartupInitResult,
  type StartupInitStage
} from "./startup-automation-types.js";
import { exists } from "./startup-workspace-hygiene.js";

export const STARTUP_DOMAIN = "ai-native-startup";

export function templateForStage(stage: StartupInitStage): string {
  switch (stage) {
    case "mvp":
    case "launch":
      return "build-mvp";
    case "scale":
      return "scale-ops";
  }
}

export async function ensureRunsteadInitialized(input: {
  cwd: string;
  profile: InitPolicyProfile;
  force: boolean;
}): Promise<{ root: string; stateDb: string }> {
  const resolved = await resolveRunsteadRoot(input.cwd);

  if (resolved.source === "missing") {
    const initialized = await initRunstead({
      cwd: input.cwd,
      profile: input.profile,
      force: input.force
    });

    return {
      root: initialized.root,
      stateDb: initialized.stateDb
    };
  }

  const state = await requireRunsteadStateDb(input.cwd);

  return {
    root: state.root,
    stateDb: state.stateDb
  };
}

export function findActiveStartupGoal(cwd: string, template: string): Goal | undefined {
  return listGoals({ cwd }).goals.find(
    (goal) =>
      goal.domain === STARTUP_DOMAIN &&
      goal.status === "active" &&
      goal.scope.templateId === template
  );
}

export async function initStartup(
  options: StartupInitOptions = {}
): Promise<StartupInitResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? "mvp";
  const initialized = await ensureRunsteadInitialized({
    cwd,
    profile: options.profile ?? "default",
    force: options.force === true
  });
  const domainPath = join(initialized.root, "domains", STARTUP_DOMAIN, "domain.yaml");
  const hadDomain = await exists(domainPath);
  let domainUpgraded = false;

  if (!hadDomain) {
    await installDomainPack({
      cwd,
      ref: STARTUP_DOMAIN,
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } else if (options.force === true) {
    await upgradeDomainPack({
      cwd,
      ref: STARTUP_DOMAIN,
      force: true,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    domainUpgraded = true;
  }

  const template = templateForStage(stage);
  const existingGoal = findActiveStartupGoal(cwd, template);

  if (existingGoal !== undefined && options.force !== true) {
    return {
      root: initialized.root,
      stateDb: initialized.stateDb,
      stage,
      domainInstalled: !hadDomain,
      domainUpgraded,
      goalCreated: false,
      goal: existingGoal,
      generatedTasks: []
    };
  }

  const created = await createGoal({
    cwd,
    domain: STARTUP_DOMAIN,
    template,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: initialized.root,
    stateDb: initialized.stateDb,
    stage,
    domainInstalled: !hadDomain,
    domainUpgraded,
    goalCreated: true,
    goal: created.goal,
    generatedTasks: created.generatedTasks
  };
}
