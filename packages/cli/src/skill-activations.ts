import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";
import { parseSkillPackageYaml, type SkillPackage } from "@runstead/skills";
import { parse as parseYaml } from "yaml";

import { localAgentTaskMode } from "./local-agent-task-input.js";

export type SkillActivationStatus = "active" | "shadow" | "disabled";
export type SkillActivationRisk = "low" | "medium" | "high";

export interface SkillActivationScope {
  repos: string[];
  taskTypes: string[];
  modes: string[];
}

export interface SkillActivationRecord {
  id: string;
  skillRoot: string;
  name: string;
  version: string;
  domain: string;
  status: SkillActivationStatus;
  risk: SkillActivationRisk;
  canaryPercent: number;
  rollbackOnRegression: boolean;
  scope: SkillActivationScope;
  sourceMemoryId?: string;
  activatedAt: string;
  activatedBy: string;
  updatedAt: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
}

export interface SkillActivationRegistry {
  version: 1;
  activations: SkillActivationRecord[];
}

export interface TaskSkillContextPack {
  retrievalId: string;
  activations: SkillActivationWithPackage[];
  shadowActivations: SkillActivationWithPackage[];
  event: RunsteadEvent;
}

export interface SkillActivationWithPackage {
  activation: SkillActivationRecord;
  skill: SkillPackage;
}

const ACTIVATION_REGISTRY_RELATIVE_PATH = join("skills", "activations.json");

export function skillActivationRegistryPath(root: string): string {
  return join(root, ACTIVATION_REGISTRY_RELATIVE_PATH);
}

export function loadSkillActivationRegistry(root: string): SkillActivationRegistry {
  const path = skillActivationRegistryPath(root);

  if (!existsSync(path)) {
    return {
      version: 1,
      activations: []
    };
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.activations)) {
    throw new Error(`Invalid skill activation registry: ${path}`);
  }

  return {
    version: 1,
    activations: parsed.activations.map(parseSkillActivationRecord)
  };
}

export function saveSkillActivationRegistry(
  root: string,
  registry: SkillActivationRegistry
): void {
  const path = skillActivationRegistryPath(root);
  const tmpPath = `${path}.tmp`;

  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

export function activateSkillPackage(input: {
  root: string;
  database?: RunsteadDatabase;
  skillRoot: string;
  status: SkillActivationStatus;
  risk: SkillActivationRisk;
  canaryPercent: number;
  rollbackOnRegression: boolean;
  activatedBy?: string;
  sourceMemoryId?: string;
  scopeRepos?: string[];
  taskTypes?: string[];
  modes?: string[];
  now?: Date;
}): SkillActivationRecord {
  const skillRoot = resolve(input.skillRoot);
  const skill = loadSkillPackageSync(skillRoot);

  if (skill.status !== "promoted") {
    throw new Error(`Only promoted skills can be activated: ${skill.status}`);
  }

  const now = (input.now ?? new Date()).toISOString();
  const registry = loadSkillActivationRegistry(input.root);
  const id = skillActivationId(skillRoot, skill);
  const existing = registry.activations.find((activation) => activation.id === id);
  const scope = activationScope({
    skill,
    ...(input.scopeRepos === undefined ? {} : { repos: input.scopeRepos }),
    ...(input.taskTypes === undefined ? {} : { taskTypes: input.taskTypes }),
    ...(input.modes === undefined ? {} : { modes: input.modes })
  });
  const activation: SkillActivationRecord = {
    id,
    skillRoot,
    name: skill.name,
    version: skill.version,
    domain: skill.domain,
    status: input.status,
    risk: input.risk,
    canaryPercent: boundedCanaryPercent(input.canaryPercent),
    rollbackOnRegression: input.rollbackOnRegression,
    scope,
    ...(input.sourceMemoryId === undefined
      ? {}
      : { sourceMemoryId: input.sourceMemoryId }),
    activatedAt: existing?.activatedAt ?? now,
    activatedBy: existing?.activatedBy ?? input.activatedBy ?? "local-admin",
    updatedAt: now
  };

  saveSkillActivationRegistry(input.root, {
    version: 1,
    activations:
      existing === undefined
        ? [...registry.activations, activation]
        : registry.activations.map((record) =>
            record.id === activation.id ? activation : record
          )
  });

  if (input.database !== undefined) {
    appendEventAndProject(input.database, {
      event: skillActivationEvent({
        type: "skill.activation_updated",
        activation,
        createdAt: now
      })
    });
  }

  return activation;
}

export function deactivateSkillActivation(input: {
  root: string;
  database?: RunsteadDatabase;
  activationId: string;
  disabledBy?: string;
  reason?: string;
  now?: Date;
}): SkillActivationRecord {
  const registry = loadSkillActivationRegistry(input.root);
  const existing = registry.activations.find(
    (activation) => activation.id === input.activationId
  );

  if (existing === undefined) {
    throw new Error(`Skill activation not found: ${input.activationId}`);
  }

  const now = (input.now ?? new Date()).toISOString();
  const disabled: SkillActivationRecord = {
    ...existing,
    status: "disabled",
    updatedAt: now,
    disabledAt: now,
    disabledBy: input.disabledBy ?? "local-admin",
    disabledReason: input.reason ?? "manual deactivation"
  };

  saveSkillActivationRegistry(input.root, {
    version: 1,
    activations: registry.activations.map((activation) =>
      activation.id === disabled.id ? disabled : activation
    )
  });

  if (input.database !== undefined) {
    appendEventAndProject(input.database, {
      event: skillActivationEvent({
        type: "skill.activation_disabled",
        activation: disabled,
        createdAt: now
      })
    });
  }

  return disabled;
}

export function buildTaskSkillContextPack(input: {
  cwd: string;
  root: string;
  database: RunsteadDatabase;
  task: Task;
  now?: Date;
}): TaskSkillContextPack | undefined {
  const registry = loadSkillActivationRegistry(input.root);
  const matching = registry.activations.flatMap((activation) => {
    const loaded = loadSkillPackageForActivation(activation);

    if (loaded === undefined || !activationMatchesTask(activation, loaded, input)) {
      return [];
    }

    return [{ activation, skill: loaded }];
  });
  const active = matching.filter(
    (record) =>
      record.activation.status === "active" &&
      canaryIncludesTask(record.activation, input.task)
  );
  const shadow = matching.filter((record) => record.activation.status === "shadow");

  if (active.length === 0 && shadow.length === 0) {
    return undefined;
  }

  const retrievalId = createRunsteadId("retr");
  const createdAt = (input.now ?? new Date()).toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "skill.context_pack_built",
    aggregateType: "task",
    aggregateId: input.task.id,
    payload: {
      retrievalId,
      taskId: input.task.id,
      repositoryPath: input.cwd,
      resultCount: active.length,
      activationIds: active.map((record) => record.activation.id),
      skillNames: active.map((record) => record.skill.name),
      shadowActivationIds: shadow.map((record) => record.activation.id)
    },
    createdAt
  };

  appendEventAndProject(input.database, { event });

  return {
    retrievalId,
    activations: active,
    shadowActivations: shadow,
    event
  };
}

export function formatTaskSkillContextPrompt(
  pack: TaskSkillContextPack | undefined
): string[] {
  if (pack === undefined || pack.activations.length === 0) {
    return [];
  }

  return [
    "Runstead active skills:",
    ...pack.activations.flatMap(({ activation, skill }) => [
      `- ${skill.name}@${skill.version} ${skill.domain} risk=${activation.risk} canary=${activation.canaryPercent}%: ${skill.description}`,
      `  triggers: ${skill.triggers.map(formatSkillTrigger).join("; ")}`,
      `  allowed_tools: ${skill.allowedTools.join(", ") || "none"}`,
      `  denied_tools: ${skill.deniedTools.join(", ") || "none"}`,
      `  verifiers: ${skill.verifiers.map((verifier) => verifier.command).join("; ") || "none"}`,
      `  rollback: ${activation.rollbackOnRegression ? "auto on regression" : "manual"}`
    ]),
    `Skill retrieval audit: ${pack.retrievalId}`,
    ""
  ];
}

export function recordTaskSkillActivationOutcomes(input: {
  root: string;
  database: RunsteadDatabase;
  task: Task;
  now?: Date;
}): SkillActivationRecord[] {
  const payload = latestSkillContextPayload(input.database, input.task.id);

  if (payload === undefined) {
    return [];
  }

  const activationIds = stringArray(payload.activationIds);
  const regression =
    input.task.status === "failed" ||
    input.task.status === "blocked" ||
    input.task.status === "interrupted";
  const createdAt = (input.now ?? new Date()).toISOString();
  const rolledBack: SkillActivationRecord[] = [];

  for (const activationId of activationIds) {
    appendEventAndProject(input.database, {
      event: {
        eventId: createRunsteadId("evt"),
        type: "skill.activation_outcome_recorded",
        aggregateType: "skill_activation",
        aggregateId: activationId,
        payload: {
          activationId,
          taskId: input.task.id,
          taskStatus: input.task.status,
          regression
        },
        createdAt
      }
    });

    const activation = loadSkillActivationRegistry(input.root).activations.find(
      (record) => record.id === activationId
    );

    if (regression && activation?.rollbackOnRegression === true) {
      rolledBack.push(
        deactivateSkillActivation({
          root: input.root,
          database: input.database,
          activationId,
          disabledBy: "runstead:auto-rollback",
          reason: `task ${input.task.id} ended with ${input.task.status}`,
          ...(input.now === undefined ? {} : { now: input.now })
        })
      );
    }
  }

  return rolledBack;
}

function loadSkillPackageSync(root: string): SkillPackage {
  return parseSkillPackageYaml(
    parseYaml(readFileSync(join(root, "skill.yaml"), "utf8"))
  );
}

function loadSkillPackageForActivation(
  activation: SkillActivationRecord
): SkillPackage | undefined {
  try {
    const skill = loadSkillPackageSync(activation.skillRoot);

    return skill.status === "promoted" ? skill : undefined;
  } catch {
    return undefined;
  }
}

function activationMatchesTask(
  activation: SkillActivationRecord,
  skill: SkillPackage,
  input: { cwd: string; task: Task }
): boolean {
  if (activation.status === "disabled") {
    return false;
  }

  if (skill.domain !== input.task.domain) {
    return false;
  }

  if (
    activation.scope.repos.length > 0 &&
    !activation.scope.repos.includes(input.cwd)
  ) {
    return false;
  }

  if (
    activation.scope.taskTypes.length > 0 &&
    !activation.scope.taskTypes.includes(input.task.type)
  ) {
    return false;
  }

  const mode = localAgentTaskMode(input.task);

  return activation.scope.modes.length === 0 || activation.scope.modes.includes(mode);
}

function skillActivationId(root: string, skill: SkillPackage): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ root, name: skill.name, version: skill.version }))
    .digest("hex")
    .slice(0, 16);

  return `skillact_${hash}`;
}

function activationScope(input: {
  skill: SkillPackage;
  repos?: string[];
  taskTypes?: string[];
  modes?: string[];
}): SkillActivationScope {
  return {
    repos: uniqueNonEmpty(input.repos ?? input.skill.scope?.repos ?? []),
    taskTypes: uniqueNonEmpty(input.taskTypes ?? []),
    modes: uniqueNonEmpty(input.modes ?? [])
  };
}

function canaryIncludesTask(activation: SkillActivationRecord, task: Task): boolean {
  if (activation.canaryPercent >= 100) {
    return true;
  }

  if (activation.canaryPercent <= 0) {
    return false;
  }

  const bucket =
    Number.parseInt(
      createHash("sha256")
        .update(`${activation.id}:${task.id}`)
        .digest("hex")
        .slice(0, 8),
      16
    ) % 100;

  return bucket < activation.canaryPercent;
}

function boundedCanaryPercent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Skill activation canary percent must be an integer from 0 to 100");
  }

  return value;
}

function skillActivationEvent(input: {
  type: string;
  activation: SkillActivationRecord;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: input.type,
    aggregateType: "skill_activation",
    aggregateId: input.activation.id,
    payload: skillActivationPayload(input.activation),
    createdAt: input.createdAt
  };
}

function skillActivationPayload(activation: SkillActivationRecord): JsonObject {
  return {
    id: activation.id,
    skillRoot: activation.skillRoot,
    name: activation.name,
    version: activation.version,
    domain: activation.domain,
    status: activation.status,
    risk: activation.risk,
    canaryPercent: activation.canaryPercent,
    rollbackOnRegression: activation.rollbackOnRegression,
    scope: activation.scope,
    ...(activation.sourceMemoryId === undefined
      ? {}
      : { sourceMemoryId: activation.sourceMemoryId }),
    activatedAt: activation.activatedAt,
    activatedBy: activation.activatedBy,
    updatedAt: activation.updatedAt,
    ...(activation.disabledAt === undefined
      ? {}
      : { disabledAt: activation.disabledAt }),
    ...(activation.disabledBy === undefined
      ? {}
      : { disabledBy: activation.disabledBy }),
    ...(activation.disabledReason === undefined
      ? {}
      : { disabledReason: activation.disabledReason })
  };
}

function latestSkillContextPayload(
  database: RunsteadDatabase,
  taskId: string
): JsonObject | undefined {
  const row = database
    .prepare(
      `
      SELECT payload_json
      FROM events
      WHERE type = 'skill.context_pack_built'
        AND aggregate_type = 'task'
        AND aggregate_id = ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(taskId) as { payload_json: string } | undefined;

  return row === undefined ? undefined : objectValue(JSON.parse(row.payload_json));
}

function parseSkillActivationRecord(value: unknown): SkillActivationRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid skill activation record");
  }

  const status = stringValue(value.status);
  const risk = stringValue(value.risk);

  if (status !== "active" && status !== "shadow" && status !== "disabled") {
    throw new Error("Invalid skill activation status");
  }

  if (risk !== "low" && risk !== "medium" && risk !== "high") {
    throw new Error("Invalid skill activation risk");
  }

  return {
    id: requiredString(value, "id"),
    skillRoot: requiredString(value, "skillRoot"),
    name: requiredString(value, "name"),
    version: requiredString(value, "version"),
    domain: requiredString(value, "domain"),
    status,
    risk,
    canaryPercent: boundedCanaryPercent(numberValue(value.canaryPercent)),
    rollbackOnRegression: value.rollbackOnRegression === true,
    scope: parseActivationScope(value.scope),
    ...optionalString(value, "sourceMemoryId"),
    activatedAt: requiredString(value, "activatedAt"),
    activatedBy: requiredString(value, "activatedBy"),
    updatedAt: requiredString(value, "updatedAt"),
    ...optionalString(value, "disabledAt"),
    ...optionalString(value, "disabledBy"),
    ...optionalString(value, "disabledReason")
  };
}

function parseActivationScope(value: unknown): SkillActivationScope {
  const scope = objectValue(value);

  return {
    repos: stringArray(scope.repos),
    taskTypes: stringArray(scope.taskTypes),
    modes: stringArray(scope.modes)
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatSkillTrigger(value: SkillPackage["triggers"][number]): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];

  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`Invalid skill activation ${key}`);
  }

  return field.trim();
}

function optionalString(
  value: Record<string, unknown>,
  key: string
): Record<string, string> {
  const field = value[key];

  return typeof field === "string" && field.trim().length > 0
    ? { [key]: field.trim() }
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function objectValue(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
