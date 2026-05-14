import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { ZodError, z } from "zod";

import { loadSkillPackageFromFile, type SkillPackage } from "./skill-package.js";

export type SkillValidationSeverity = "error" | "warning";

export interface SkillValidationIssue {
  severity: SkillValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface SkillPackageValidationResult {
  root: string;
  valid: boolean;
  skill?: SkillPackage;
  issues: SkillValidationIssue[];
}

const REQUIRED_FILES = [
  "skill.yaml",
  "SKILL.md",
  "permissions.yaml",
  "tests/run.sh",
  "rollback.md"
];

const PermissionsFileSchema = z.record(z.string().min(1), z.string().min(1));

export async function validateSkillPackageDir(
  root: string
): Promise<SkillPackageValidationResult> {
  const resolvedRoot = resolve(root);
  const issues: SkillValidationIssue[] = [];
  let skill: SkillPackage | undefined;

  for (const file of REQUIRED_FILES) {
    if (!(await isReadable(join(resolvedRoot, file)))) {
      issues.push({
        severity: "error",
        code: "missing_required_file",
        message: `Missing required skill package file: ${file}`,
        path: file
      });
    }
  }

  if (
    (await isReadable(join(resolvedRoot, "tests/run.sh"))) &&
    !(await isExecutable(join(resolvedRoot, "tests/run.sh")))
  ) {
    issues.push({
      severity: "error",
      code: "test_script_not_executable",
      message: "Skill package test script must be executable: tests/run.sh",
      path: "tests/run.sh"
    });
  }

  try {
    skill = await loadSkillPackageFromFile(join(resolvedRoot, "skill.yaml"));
  } catch (error) {
    issues.push({
      severity: "error",
      code: "invalid_skill_yaml",
      message: validationErrorMessage(error),
      path: "skill.yaml"
    });
  }

  if (skill !== undefined) {
    issues.push(...validateSkillPackageSemantics(skill));
    await validatePermissionsFile({
      root: resolvedRoot,
      skill,
      issues
    });
  }

  return {
    root: resolvedRoot,
    valid: !issues.some((issue) => issue.severity === "error"),
    ...(skill === undefined ? {} : { skill }),
    issues
  };
}

export function formatSkillValidationReport(
  result: SkillPackageValidationResult
): string {
  const lines = [
    `Skill package: ${result.root}`,
    `Status: ${result.valid ? "valid" : "invalid"}`
  ];

  if (result.skill !== undefined) {
    lines.push(`Name: ${result.skill.name}`);
    lines.push(`Version: ${result.skill.version}`);
    lines.push(`Domain: ${result.skill.domain}`);
  }

  if (result.issues.length === 0) {
    lines.push("Issues: none");
    return lines.join("\n");
  }

  lines.push("Issues:");
  for (const issue of result.issues) {
    lines.push(
      `  [${issue.severity}] ${issue.code}${issue.path === undefined ? "" : ` ${issue.path}`}: ${issue.message}`
    );
  }

  return lines.join("\n");
}

function validateSkillPackageSemantics(skill: SkillPackage): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const allowed = new Set(skill.allowedTools);
  const denied = new Set(skill.deniedTools);
  const overlap = [...allowed].filter((tool) => denied.has(tool));

  if (overlap.length > 0) {
    issues.push({
      severity: "error",
      code: "tool_policy_overlap",
      message: `Tools cannot be both allowed and denied: ${overlap.join(", ")}`,
      path: "skill.yaml"
    });
  }

  if (skill.status !== "candidate") {
    issues.push({
      severity: "warning",
      code: "non_candidate_status",
      message: `Validator currently expects manual review for ${skill.status} skills`,
      path: "skill.yaml"
    });
  }

  if (skill.provenance.createdFromTasks.length === 0) {
    issues.push({
      severity: "error",
      code: "missing_task_provenance",
      message: "Skill packages must include task provenance",
      path: "skill.yaml"
    });
  }

  return issues;
}

async function validatePermissionsFile(input: {
  root: string;
  skill: SkillPackage;
  issues: SkillValidationIssue[];
}): Promise<void> {
  const path = join(input.root, "permissions.yaml");

  if (!(await isReadable(path))) {
    return;
  }

  try {
    const permissions = PermissionsFileSchema.parse(
      parseYaml(await readFile(path, "utf8"))
    );

    if (!sameStringRecord(permissions, input.skill.permissions)) {
      input.issues.push({
        severity: "error",
        code: "permissions_file_mismatch",
        message: "permissions.yaml must match skill.yaml permissions",
        path: "permissions.yaml"
      });
    }
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "invalid_permissions_yaml",
      message: validationErrorMessage(error),
      path: "permissions.yaml"
    });
  }
}

function sameStringRecord(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );

  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function validationErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "Unknown validation error";
}
