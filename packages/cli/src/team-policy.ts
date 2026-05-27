import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { stringify as stringifyYaml } from "yaml";

import { createRepoMaintenanceMinimumPolicy, type PolicyProfile } from "./policy.js";
import { requireRunsteadRoot, requireRunsteadStateDbSync } from "./runstead-root.js";
import {
  DEFAULT_TEAM_POLICY_YAML,
  loadTeamPolicy,
  parseTeamPolicyYaml,
  teamPolicyExists,
  type TeamPolicy
} from "./team-policy-config.js";

export {
  DEFAULT_TEAM_POLICY_YAML,
  loadTeamPolicy,
  type TeamPolicy
} from "./team-policy-config.js";

export interface InitTeamPolicyOptions {
  cwd?: string;
  force?: boolean;
}

export interface InitTeamPolicyResult {
  path: string;
  policy: TeamPolicy;
  overwritten: boolean;
}

export interface CompileTeamPolicyOptions {
  cwd?: string;
  output?: string;
  now?: Date;
}

export interface CompileTeamPolicyResult {
  sourcePath: string;
  outputPath: string;
  teamPolicy: TeamPolicy;
  policy: PolicyProfile;
  event: RunsteadEvent;
  stateDb: string;
}

export async function initTeamPolicy(
  options: InitTeamPolicyOptions = {}
): Promise<InitTeamPolicyResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "team-policy.yaml");
  const existing = await teamPolicyExists(path);

  if (existing && options.force !== true) {
    return {
      path,
      policy: await loadTeamPolicy(
        options.cwd === undefined ? {} : { cwd: options.cwd }
      ),
      overwritten: false
    };
  }

  const policy = parseTeamPolicyYaml(DEFAULT_TEAM_POLICY_YAML);

  await writeFile(path, DEFAULT_TEAM_POLICY_YAML, "utf8");

  return {
    path,
    policy,
    overwritten: existing
  };
}

export async function compileTeamPolicy(
  options: CompileTeamPolicyOptions = {}
): Promise<CompileTeamPolicyResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const sourcePath = join(root, "team-policy.yaml");

  if (!(await teamPolicyExists(sourcePath))) {
    await writeFile(sourcePath, DEFAULT_TEAM_POLICY_YAML, "utf8");
  }

  const teamPolicy = await loadTeamPolicy(
    options.cwd === undefined ? {} : { cwd: options.cwd }
  );
  const policy = compileTeamPolicyProfile(teamPolicy);
  const outputPath =
    options.output === undefined
      ? join(root, "policies", "team-policy.yaml")
      : resolve(options.output);
  const compiledAt = (options.now ?? new Date()).toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "team_policy.compiled",
    aggregateType: "team_policy",
    aggregateId: teamPolicy.id,
    payload: {
      sourcePath,
      outputPath,
      policyId: policy.id,
      rules: policy.rules.length
    },
    createdAt: compiledAt
  };
  const stateDb = requireRunsteadStateDbSync(options.cwd ?? process.cwd()).stateDb;
  const database = openRunsteadDatabase(stateDb);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatPolicyProfileYaml(policy), "utf8");

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    sourcePath,
    outputPath,
    teamPolicy,
    policy,
    event,
    stateDb
  };
}

export function compileTeamPolicyProfile(policy: TeamPolicy): PolicyProfile {
  return createRepoMaintenanceMinimumPolicy({
    id: policy.id,
    protectedPaths: policy.protectedPaths,
    verifierCommandPatterns: policy.verifierCommands,
    externalWriteSideEffects: policy.externalWriteSideEffects,
    dependencyChangeActionTypes: policy.dependencyChangeActionTypes,
    dependencyChangePaths: policy.dependencyChangePaths
  });
}

export function formatTeamPolicySummary(policy: TeamPolicy): string {
  return [
    `Team policy: ${policy.id}`,
    `Protected paths: ${policy.protectedPaths.length}`,
    `Verifier commands: ${policy.verifierCommands.length}`,
    `External write side effects: ${policy.externalWriteSideEffects.length}`,
    `Dependency paths: ${policy.dependencyChangePaths.length}`
  ].join("\n");
}

function formatPolicyProfileYaml(policy: PolicyProfile): string {
  return stringifyYaml({
    id: policy.id,
    version: policy.version,
    ...(policy.defaultDecision === undefined
      ? {}
      : { default_decision: policy.defaultDecision }),
    ...(policy.defaultRisk === undefined ? {} : { default_risk: policy.defaultRisk }),
    rules: policy.rules.map((rule) => ({
      id: rule.id,
      when: {
        ...(rule.when.actionType === undefined
          ? {}
          : { action_type: formatActionType(rule.when.actionType) }),
        ...(rule.when.riskClass === undefined
          ? {}
          : { risk_class: formatActionType(rule.when.riskClass) }),
        ...(rule.when.path === undefined
          ? {}
          : { path: { matches_any: rule.when.path.matchesAny } }),
        ...(rule.when.command === undefined
          ? {}
          : { command: { matches_any: rule.when.command.matchesAny } }),
        ...(rule.when.sideEffects === undefined
          ? {}
          : {
              side_effects: {
                contains_any: rule.when.sideEffects.containsAny
              }
            })
      },
      decision: rule.decision,
      risk: rule.risk,
      ...(rule.obligations === undefined ? {} : { obligations: rule.obligations })
    }))
  });
}

function formatActionType(actionType: string | string[]): string | { in: string[] } {
  return Array.isArray(actionType) ? { in: actionType } : actionType;
}

async function resolveInitializedRoot(cwd = process.cwd()): Promise<string> {
  const root = await requireRunsteadRoot(resolve(cwd));

  return root.root;
}
