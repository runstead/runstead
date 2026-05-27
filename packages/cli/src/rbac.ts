import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadRoot, requireRunsteadStateDbSync } from "./runstead-root.js";
import {
  assertKnownRbacRole,
  createDefaultRbacPolicy,
  loadRbacPolicy,
  rbacPolicyExists,
  writeRbacPolicy,
  type RbacPolicy
} from "./rbac-policy.js";

export {
  DEFAULT_RBAC_YAML,
  createDefaultRbacPolicy,
  loadRbacPolicy,
  type RbacPolicy
} from "./rbac-policy.js";

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
  actor?: string;
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

export async function initRbac(options: InitRbacOptions = {}): Promise<InitRbacResult> {
  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "rbac.yaml");
  const role = options.role ?? "admin";
  const subject = options.subject ?? "local-admin";
  const existing = await rbacPolicyExists(path);

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
  const actor = options.actor ?? "local-admin";
  const permission = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: actor,
    permission: "rbac.manage"
  });

  if (permission.decision !== "allow") {
    throw new Error(`Subject ${actor} cannot manage RBAC: ${permission.reason}`);
  }

  const root = await resolveInitializedRoot(options.cwd);
  const path = join(root, "rbac.yaml");
  const policy = (await rbacPolicyExists(path))
    ? await loadRbacPolicy(options.cwd === undefined ? {} : { cwd: options.cwd })
    : createDefaultRbacPolicy();

  assertKnownRbacRole(policy, options.role);

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
      role: options.role,
      grantedBy: actor
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

export function formatRbacCheckResult(result: CheckPermissionResult): string {
  return [
    `Subject: ${result.subject}`,
    `Permission: ${result.permission}`,
    `Decision: ${result.decision}`,
    `Roles: ${result.roles.join(", ") || "none"}`,
    `Reason: ${result.reason}`
  ].join("\n");
}

async function resolveInitializedRoot(cwd = process.cwd()): Promise<string> {
  const root = await requireRunsteadRoot(resolve(cwd));

  return root.root;
}
