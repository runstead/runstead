import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { DomainPack } from "./domain-pack.js";
import { loadDomainPackFromFile } from "./domain-pack.js";
import type { GoalTemplate } from "./goal-template.js";
import { loadGoalTemplateFromFile } from "./goal-template.js";
import type { TaskType } from "./task-type.js";
import { loadTaskTypeFromFile } from "./task-type.js";

export type DomainPackValidationSeverity = "error" | "warning";

export interface DomainPackValidationIssue {
  severity: DomainPackValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface DomainPackValidationResult {
  root: string;
  valid: boolean;
  issues: DomainPackValidationIssue[];
  domain?: DomainPack;
  goalTemplates: GoalTemplate[];
  taskTypes: TaskType[];
}

export async function validateDomainPackDir(
  root: string
): Promise<DomainPackValidationResult> {
  const resolvedRoot = resolve(root);
  const issues: DomainPackValidationIssue[] = [];
  const goalTemplates: GoalTemplate[] = [];
  const taskTypes: TaskType[] = [];
  const domainPath = join(resolvedRoot, "domain.yaml");
  const domain = await loadDomain(resolvedRoot, domainPath, issues);

  if (domain !== undefined) {
    collectDuplicateReferences("goal_template", domain.goalTemplates, issues);
    collectDuplicateReferences("task_type", domain.taskTypes, issues);

    for (const templateId of domain.goalTemplates) {
      const templatePath = referencePath({
        root: resolvedRoot,
        directory: "goal-templates",
        id: templateId,
        codePrefix: "goal_template",
        issues
      });

      if (templatePath === undefined) {
        continue;
      }

      const template = await loadGoalTemplate(templatePath, issues);

      if (template === undefined) {
        continue;
      }

      goalTemplates.push(template);
      assertReferencedDocument({
        kind: "goal template",
        expectedId: templateId,
        expectedDomain: domain.id,
        actualId: template.id,
        actualDomain: template.domain,
        path: templatePath,
        issues
      });
    }

    for (const taskTypeId of domain.taskTypes) {
      const taskTypePath = referencePath({
        root: resolvedRoot,
        directory: "task-types",
        id: taskTypeId,
        codePrefix: "task_type",
        issues
      });

      if (taskTypePath === undefined) {
        continue;
      }

      const taskType = await loadTaskType(taskTypePath, issues);

      if (taskType === undefined) {
        continue;
      }

      taskTypes.push(taskType);
      assertReferencedDocument({
        kind: "task type",
        expectedId: taskTypeId,
        expectedDomain: domain.id,
        actualId: taskType.id,
        actualDomain: taskType.domain,
        path: taskTypePath,
        issues
      });
    }

    await assertFileExists({
      path: join(resolvedRoot, domain.defaultPolicy),
      root: resolvedRoot,
      code: "default_policy_missing",
      message: `Default policy file is missing: ${domain.defaultPolicy}`,
      issues
    });
  }

  return {
    root: resolvedRoot,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    ...(domain === undefined ? {} : { domain }),
    goalTemplates,
    taskTypes
  };
}

export function formatDomainPackValidationResult(
  result: DomainPackValidationResult
): string {
  return [
    "Runstead domain pack validation",
    `Path: ${result.root}`,
    `Status: ${result.valid ? "valid" : "invalid"}`,
    ...(result.domain === undefined ? [] : [`Domain: ${result.domain.id}`]),
    `Goal templates: ${result.goalTemplates.length}`,
    `Task types: ${result.taskTypes.length}`,
    ...result.issues.map(
      (issue) =>
        `  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${
          issue.path === undefined ? "" : ` (${issue.path})`
        }`
    )
  ].join("\n");
}

async function loadDomain(
  root: string,
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<DomainPack | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "domain_yaml_missing",
      message: "Domain pack must include domain.yaml",
      path
    });
    return undefined;
  }

  try {
    return await loadDomainPackFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "domain_yaml_invalid",
      message: errorMessage(error),
      path: relativeToRoot(root, path)
    });
    return undefined;
  }
}

async function loadGoalTemplate(
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<GoalTemplate | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "goal_template_missing",
      message: `Goal template file is missing: ${path}`,
      path
    });
    return undefined;
  }

  try {
    return await loadGoalTemplateFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "goal_template_invalid",
      message: errorMessage(error),
      path
    });
    return undefined;
  }
}

async function loadTaskType(
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<TaskType | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "task_type_missing",
      message: `Task type file is missing: ${path}`,
      path
    });
    return undefined;
  }

  try {
    return await loadTaskTypeFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "task_type_invalid",
      message: errorMessage(error),
      path
    });
    return undefined;
  }
}

function referencePath(input: {
  root: string;
  directory: string;
  id: string;
  codePrefix: string;
  issues: DomainPackValidationIssue[];
}): string | undefined {
  if (input.id.includes("/") || input.id.includes("\\") || input.id.includes("..")) {
    input.issues.push({
      severity: "error",
      code: `${input.codePrefix}_unsafe_reference`,
      message: `Pack reference must be a local id, received: ${input.id}`
    });
    return undefined;
  }

  return join(input.root, input.directory, `${input.id}.yaml`);
}

async function assertFileExists(input: {
  path: string;
  root: string;
  code: string;
  message: string;
  issues: DomainPackValidationIssue[];
}): Promise<void> {
  const resolvedPath = resolve(input.path);

  if (!isWithinRoot(input.root, resolvedPath)) {
    input.issues.push({
      severity: "error",
      code: "path_escapes_pack",
      message: `Referenced path escapes the domain pack: ${resolvedPath}`,
      path: resolvedPath
    });
    return;
  }

  if (!(await fileExists(resolvedPath))) {
    input.issues.push({
      severity: "error",
      code: input.code,
      message: input.message,
      path: resolvedPath
    });
  }
}

function assertReferencedDocument(input: {
  kind: string;
  expectedId: string;
  expectedDomain: string;
  actualId: string;
  actualDomain: string;
  path: string;
  issues: DomainPackValidationIssue[];
}): void {
  if (input.actualId !== input.expectedId) {
    input.issues.push({
      severity: "error",
      code: `${input.kind.replaceAll(" ", "_")}_id_mismatch`,
      message: `Referenced ${input.kind} ${input.expectedId} has id ${input.actualId}`,
      path: input.path
    });
  }

  if (input.actualDomain !== input.expectedDomain) {
    input.issues.push({
      severity: "error",
      code: `${input.kind.replaceAll(" ", "_")}_domain_mismatch`,
      message: `Referenced ${input.kind} ${input.expectedId} belongs to ${input.actualDomain}, expected ${input.expectedDomain}`,
      path: input.path
    });
  }
}

function collectDuplicateReferences(
  kind: string,
  references: string[],
  issues: DomainPackValidationIssue[]
): void {
  const seen = new Set<string>();

  for (const reference of references) {
    if (seen.has(reference)) {
      issues.push({
        severity: "error",
        code: `${kind}_duplicate_reference`,
        message: `Duplicate ${kind.replaceAll("_", " ")} reference: ${reference}`
      });
    }

    seen.add(reference);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isWithinRoot(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);

  return (
    resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function relativeToRoot(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);

  return isWithinRoot(resolvedRoot, resolvedPath)
    ? resolvedPath.slice(resolvedRoot.length + 1)
    : resolvedPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
