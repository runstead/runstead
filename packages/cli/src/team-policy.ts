import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  createRepoMaintenanceMinimumPolicy,
  DEFAULT_DEPENDENCY_CHANGE_ACTION_TYPES,
  DEFAULT_DEPENDENCY_CHANGE_PATHS,
  DEFAULT_EXTERNAL_WRITE_SIDE_EFFECTS,
  DEFAULT_VERIFIER_COMMAND_PATTERNS,
  type PolicyProfile
} from "./policy.js";
import {
  requireRunsteadRoot,
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";

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

export const DEFAULT_TEAM_POLICY_YAML = `id: team_policy_repo_maintenance_v1
version: 1

protected_paths:
  - ".env"
  - ".env.*"
  - "**/secrets/**"
  - "infra/prod/**"

verifier_commands:
  - "^pnpm test( .*)?$"
  - "^pnpm run lint( .*)?$"
  - "^npm test( .*)?$"
  - "^npm run lint( .*)?$"
  - "^yarn test( .*)?$"
  - "^yarn lint( .*)?$"
  - "^bun test( .*)?$"
  - "^bun run lint( .*)?$"

external_write_side_effects:
  - network_write_external
  - send_message_external
  - git_push
  - github_pr_create

dependency_change:
  action_types:
    - package.install
    - package.update
  paths:
    - package.json
    - package-lock.json
    - pnpm-lock.yaml
    - yarn.lock
    - bun.lockb
    - requirements.txt
    - poetry.lock
    - uv.lock
    - go.mod
    - go.sum
    - Cargo.toml
    - Cargo.lock
`;

const TeamPolicyYamlSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  protected_paths: z.array(z.string().min(1)),
  verifier_commands: z.array(z.string().min(1)).optional(),
  external_write_side_effects: z.array(z.string().min(1)).optional(),
  dependency_change: z
    .object({
      action_types: z.array(z.string().min(1)).optional(),
      paths: z.array(z.string().min(1)).optional()
    })
    .optional()
});

export interface TeamPolicy {
  id: string;
  version: 1;
  protectedPaths: string[];
  verifierCommands: string[];
  externalWriteSideEffects: string[];
  dependencyChangeActionTypes: string[];
  dependencyChangePaths: string[];
}

export async function initTeamPolicy(
  options: InitTeamPolicyOptions = {}
): Promise<InitTeamPolicyResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "team-policy.yaml");
  const existing = await exists(path);

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

  if (!(await exists(sourcePath))) {
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

export async function loadTeamPolicy(
  options: { cwd?: string } = {}
): Promise<TeamPolicy> {
  const path = resolveTeamPolicyPath(options.cwd);

  if (!(await exists(path))) {
    return parseTeamPolicyYaml(DEFAULT_TEAM_POLICY_YAML);
  }

  return parseTeamPolicyYaml(await readFile(path, "utf8"));
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

function parseTeamPolicyYaml(raw: string): TeamPolicy {
  const parsed = TeamPolicyYamlSchema.parse(parseYaml(raw));

  return {
    id: parsed.id,
    version: parsed.version,
    protectedPaths: parsed.protected_paths,
    verifierCommands: parsed.verifier_commands ?? DEFAULT_VERIFIER_COMMAND_PATTERNS,
    externalWriteSideEffects:
      parsed.external_write_side_effects ?? DEFAULT_EXTERNAL_WRITE_SIDE_EFFECTS,
    dependencyChangeActionTypes:
      parsed.dependency_change?.action_types ?? DEFAULT_DEPENDENCY_CHANGE_ACTION_TYPES,
    dependencyChangePaths:
      parsed.dependency_change?.paths ?? DEFAULT_DEPENDENCY_CHANGE_PATHS
  };
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

function resolveTeamPolicyPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "team-policy.yaml");
}

async function resolveInitializedRoot(cwd = process.cwd()): Promise<string> {
  const root = await requireRunsteadRoot(resolve(cwd));

  return root.root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
