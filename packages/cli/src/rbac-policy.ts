import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { requireRunsteadRootSync } from "./runstead-root.js";

export const DEFAULT_RBAC_YAML = `version: 1

roles:
  viewer:
    - dashboard.read
    - domain.read
    - repo.read
    - goal.read
    - task.read
    - evidence.read
    - memory.read
    - audit.read
  operator:
    - dashboard.read
    - dashboard.manage
    - domain.read
    - domain.manage
    - repo.read
    - repo.manage
    - goal.read
    - goal.manage
    - task.read
    - task.run
    - evidence.read
    - evidence.write
    - memory.read
    - memory.write
    - daemon.manage
    - webhook.manage
    - team_policy.read
    - team_policy.manage
    - github_app.read
    - github_app.manage
  approver:
    - dashboard.read
    - domain.read
    - repo.read
    - goal.read
    - task.read
    - evidence.read
    - memory.read
    - approval.read
    - approval.decide
  admin:
    - "*"

subjects:
  local-admin:
    roles:
      - admin
`;

const RbacSubjectSchema = z.object({
  roles: z.array(z.string().min(1))
});

const RbacPolicySchema = z.object({
  version: z.literal(1),
  roles: z.record(z.string(), z.array(z.string().min(1))),
  subjects: z.record(z.string(), RbacSubjectSchema)
});

export type RbacPolicy = z.infer<typeof RbacPolicySchema>;

export async function loadRbacPolicy(
  options: { cwd?: string } = {}
): Promise<RbacPolicy> {
  const path = resolveRbacPath(options.cwd);

  if (!(await rbacPolicyExists(path))) {
    return parseRbacPolicy(DEFAULT_RBAC_YAML);
  }

  return parseRbacPolicy(await readFile(path, "utf8"));
}

export function createDefaultRbacPolicy(
  subject = "local-admin",
  role = "admin"
): RbacPolicy {
  const policy = parseRbacPolicy(DEFAULT_RBAC_YAML);

  assertKnownRbacRole(policy, role);
  policy.subjects = {
    [subject]: {
      roles: [role]
    }
  };

  return policy;
}

export async function writeRbacPolicy(path: string, policy: RbacPolicy): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(policy), "utf8");
}

export function resolveRbacPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "rbac.yaml");
}

export function assertKnownRbacRole(policy: RbacPolicy, role: string): void {
  if (policy.roles[role] === undefined) {
    throw new Error(`Unknown RBAC role: ${role}`);
  }
}

export async function rbacPolicyExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseRbacPolicy(raw: string): RbacPolicy {
  return RbacPolicySchema.parse(parseYaml(raw));
}
