import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { DoctorCheck } from "./doctor.js";
import { doctorRunstead } from "./doctor.js";
import { initRunstead } from "./init.js";
import { TRUSTED_LOCAL_MODEL_INFERENCE_RESOURCE_IDS } from "./policy.js";
import { resolveRunsteadRoot } from "./runstead-root.js";

const READ_WORKSPACE_ACTION_TYPES = [
  "filesystem.read",
  "filesystem.list",
  "filesystem.search",
  "filesystem.stat",
  "git.status",
  "git.diff",
  "git.log",
  "git.show",
  "git.diff.summary",
  "repo.metadata.read",
  "evidence.read",
  "workspace.facts.read",
  "github.run.read",
  "github.run.log.read"
];
const VERIFIER_COMMAND_ACTION_TYPES = ["shell.exec", "verifier.run"];

export interface UpgradeRunsteadStateOptions {
  cwd?: string;
}

export interface UpgradeRunsteadStateResult {
  root: string;
  stateDb: string;
  checks: DoctorCheck[];
}

export async function upgradeRunsteadState(
  options: UpgradeRunsteadStateOptions = {}
): Promise<UpgradeRunsteadStateResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolved = await resolveRunsteadRoot(cwd);

  if (resolved.source === "missing") {
    throw new Error(`Runstead is not initialized at ${resolved.root}. Run init first.`);
  }

  if (resolved.source === "team") {
    throw new Error(
      "Runstead upgrade requires .runstead state. Run migrate .team .runstead first."
    );
  }

  const initialized = await initRunstead({ cwd });

  await repairRepoMaintenancePolicy(
    join(initialized.root, "policies", "repo-maintenance.yaml")
  );

  const doctor = await doctorRunstead({ cwd });

  if (!doctor.ok) {
    const failed = doctor.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.id)
      .join(", ");

    throw new Error(`Runstead upgrade left an unhealthy state: ${failed}`);
  }

  return {
    root: initialized.root,
    stateDb: initialized.stateDb,
    checks: doctor.checks
  };
}

async function repairRepoMaintenancePolicy(policyPath: string): Promise<void> {
  const raw = await readFile(policyPath, "utf8");
  const policy = parseYaml(raw) as unknown;

  if (!isRecord(policy) || !Array.isArray(policy.rules)) {
    return;
  }

  let changed = false;

  changed =
    ensureRuleActionTypes(
      policy.rules,
      "allow_read_workspace",
      READ_WORKSPACE_ACTION_TYPES
    ) || changed;
  changed =
    ensureRuleActionTypes(
      policy.rules,
      "allow_verifier_commands",
      VERIFIER_COMMAND_ACTION_TYPES
    ) || changed;
  changed =
    ensureRuleResourceIds(
      policy.rules,
      "allow_trusted_local_model_inference_request",
      TRUSTED_LOCAL_MODEL_INFERENCE_RESOURCE_IDS
    ) || changed;

  if (changed) {
    await writeFile(policyPath, stringifyYaml(policy), "utf8");
  }
}

function ensureRuleActionTypes(
  rules: unknown[],
  ruleId: string,
  requiredActionTypes: string[]
): boolean {
  const rule = rules.find(
    (candidate) => isRecord(candidate) && candidate.id === ruleId
  );

  if (!isRecord(rule) || !isRecord(rule.when)) {
    return false;
  }

  const existing = readActionTypes(rule.when.action_type);
  const updated = uniqueStrings([...existing, ...requiredActionTypes]);

  if (arraysEqual(existing, updated)) {
    return false;
  }

  rule.when.action_type = { in: updated };

  return true;
}

function ensureRuleResourceIds(
  rules: unknown[],
  ruleId: string,
  requiredResourceIds: string[]
): boolean {
  const rule = rules.find(
    (candidate) => isRecord(candidate) && candidate.id === ruleId
  );

  if (!isRecord(rule) || !isRecord(rule.when)) {
    return false;
  }

  const existing = readStringMatcher(rule.when.resource_id);
  const updated = uniqueStrings([...existing, ...requiredResourceIds]);

  if (arraysEqual(existing, updated)) {
    return false;
  }

  rule.when.resource_id = { in: updated };

  return true;
}

function readActionTypes(value: unknown): string[] {
  return readStringMatcher(value);
}

function readStringMatcher(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (isRecord(value) && Array.isArray(value.in)) {
    return value.in.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatUpgradeRunsteadReport(
  result: UpgradeRunsteadStateResult
): string {
  return [
    `Upgraded ${result.root}`,
    `State: ${result.stateDb}`,
    `Checks: ${result.checks.length} passed`
  ].join("\n");
}
