import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  DEFAULT_DEPENDENCY_CHANGE_ACTION_TYPES,
  DEFAULT_DEPENDENCY_CHANGE_PATHS,
  DEFAULT_EXTERNAL_WRITE_SIDE_EFFECTS,
  DEFAULT_VERIFIER_COMMAND_PATTERNS
} from "./policy.js";
import { requireRunsteadRootSync } from "./runstead-root.js";

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

export async function loadTeamPolicy(
  options: { cwd?: string } = {}
): Promise<TeamPolicy> {
  const path = resolveTeamPolicyPath(options.cwd);

  if (!(await teamPolicyExists(path))) {
    return parseTeamPolicyYaml(DEFAULT_TEAM_POLICY_YAML);
  }

  return parseTeamPolicyYaml(await readFile(path, "utf8"));
}

export function parseTeamPolicyYaml(raw: string): TeamPolicy {
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

export function resolveTeamPolicyPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "team-policy.yaml");
}

export async function teamPolicyExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
