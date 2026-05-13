import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import {
  requireRunsteadRoot,
  requireRunsteadRootSync,
  requireRunsteadStateDbSync
} from "./runstead-root.js";

export type RbacDecision = "allow" | "deny";

export interface InitRbacOptions {
  cwd?: string;
  subject?: string;
  role?: string;
  force?: boolean;
}

export interface InitRbacResult {
  path: string;
  policy: RbacPolicy;
  overwritten: boolean;
}

export interface GrantRoleOptions {
  cwd?: string;
  subject: string;
  role: string;
  now?: Date;
}

export interface GrantRoleResult {
  path: string;
  policy: RbacPolicy;
  event: RunsteadEvent;
  stateDb: string;
}

export interface CheckPermissionOptions {
  cwd?: string;
  subject: string;
  permission: string;
}

export interface CheckPermissionResult {
  subject: string;
  permission: string;
  decision: RbacDecision;
  roles: string[];
  reason: string;
}

export const DEFAULT_RBAC_YAML = `version: 1

roles:
  viewer:
    - dashboard.read
    - repo.read
    - goal.read
    - task.read
    - audit.read
  operator:
    - dashboard.read
    - repo.read
    - repo.manage
    - goal.read
    - goal.manage
    - task.read
    - task.run
    - daemon.manage
  approver:
    - dashboard.read
    - repo.read
    - goal.read
    - task.read
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

export async function initRbac(options: InitRbacOptions = {}): Promise<InitRbacResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "rbac.yaml");
  const role = options.role ?? "admin";
  const subject = options.subject ?? "local-admin";
  const existing = await exists(path);

  if (existing && options.force !== true) {
    return {
      path,
      policy: await loadRbacPolicy(
        options.cwd === undefined ? {} : { cwd: options.cwd }
      ),
      overwritten: false
    };
  }

  const policy = createDefaultRbacPolicy(subject, role);

  await writeRbacPolicy(path, policy);

  return {
    path,
    policy,
    overwritten: existing
  };
}

export async function grantRole(options: GrantRoleOptions): Promise<GrantRoleResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "rbac.yaml");
  const policy = (await exists(path))
    ? await loadRbacPolicy(options.cwd === undefined ? {} : { cwd: options.cwd })
    : createDefaultRbacPolicy();

  assertKnownRole(policy, options.role);

  const currentRoles = policy.subjects[options.subject]?.roles ?? [];
  policy.subjects[options.subject] = {
    roles: [...new Set([...currentRoles, options.role])].sort()
  };

  await writeRbacPolicy(path, policy);

  const grantedAt = (options.now ?? new Date()).toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "rbac.role_granted",
    aggregateType: "rbac_subject",
    aggregateId: options.subject,
    payload: {
      subject: options.subject,
      role: options.role
    },
    createdAt: grantedAt
  };
  const stateDb = requireRunsteadStateDbSync(options.cwd ?? process.cwd()).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    path,
    policy,
    event,
    stateDb
  };
}

export async function checkPermission(
  options: CheckPermissionOptions
): Promise<CheckPermissionResult> {
  const policy = await loadRbacPolicy(
    options.cwd === undefined ? {} : { cwd: options.cwd }
  );
  const roles = policy.subjects[options.subject]?.roles ?? [];

  for (const role of roles) {
    const permissions = policy.roles[role] ?? [];

    if (permissions.includes("*") || permissions.includes(options.permission)) {
      return {
        subject: options.subject,
        permission: options.permission,
        decision: "allow",
        roles,
        reason: `Role ${role} grants ${options.permission}`
      };
    }
  }

  return {
    subject: options.subject,
    permission: options.permission,
    decision: "deny",
    roles,
    reason:
      roles.length === 0
        ? `Subject ${options.subject} has no roles`
        : `No role grants ${options.permission}`
  };
}

export async function loadRbacPolicy(
  options: { cwd?: string } = {}
): Promise<RbacPolicy> {
  const path = resolveRbacPath(options.cwd);

  if (!(await exists(path))) {
    return parseRbacPolicy(DEFAULT_RBAC_YAML);
  }

  return parseRbacPolicy(await readFile(path, "utf8"));
}

export function createDefaultRbacPolicy(
  subject = "local-admin",
  role = "admin"
): RbacPolicy {
  const policy = parseRbacPolicy(DEFAULT_RBAC_YAML);

  assertKnownRole(policy, role);
  policy.subjects = {
    [subject]: {
      roles: [role]
    }
  };

  return policy;
}

export function formatRbacCheckResult(result: CheckPermissionResult): string {
  return [
    `Subject: ${result.subject}`,
    `Permission: ${result.permission}`,
    `Decision: ${result.decision}`,
    `Roles: ${result.roles.join(", ") || "none"}`,
    `Reason: ${result.reason}`
  ].join("\n");
}

function parseRbacPolicy(raw: string): RbacPolicy {
  return RbacPolicySchema.parse(parseYaml(raw));
}

async function writeRbacPolicy(path: string, policy: RbacPolicy): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(policy), "utf8");
}

function resolveRbacPath(cwd = process.cwd()): string {
  const root = requireRunsteadRootSync(cwd);

  return join(root.root, "rbac.yaml");
}

async function resolveInitializedRoot(cwd = process.cwd()): Promise<string> {
  const root = await requireRunsteadRoot(resolve(cwd));

  return root.root;
}

function assertKnownRole(policy: RbacPolicy, role: string): void {
  if (policy.roles[role] === undefined) {
    throw new Error(`Unknown RBAC role: ${role}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
