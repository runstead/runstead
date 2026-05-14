import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { SkillPackage } from "./skill-package.js";
import { loadSkillPackageFromFile } from "./skill-package.js";
import {
  formatSkillTestReport,
  runSkillPackageTests,
  type SkillTestResult
} from "./test-runner.js";
import {
  validateSkillPackageDir,
  type SkillPackageValidationResult
} from "./validator.js";

export interface PromoteSkillPackageOptions {
  root: string;
  promotedBy?: string;
  now?: Date;
}

export interface PromoteSkillPackageResult {
  root: string;
  previousStatus: "candidate";
  skill: SkillPackage;
  test: SkillTestResult;
  validation: SkillPackageValidationResult;
}

export interface DeprecateSkillPackageOptions {
  root: string;
  deprecatedBy?: string;
  reason?: string;
  now?: Date;
}

export interface DeprecateSkillPackageResult {
  root: string;
  previousStatus: "promoted";
  skill: SkillPackage;
  validation: SkillPackageValidationResult;
}

type SkillStatus = SkillPackage["status"];

export async function promoteSkillPackage(
  options: PromoteSkillPackageOptions
): Promise<PromoteSkillPackageResult> {
  const root = resolve(options.root);
  const skillPath = join(root, "skill.yaml");
  const current = await loadSkillPackageFromFile(skillPath);

  if (current.status !== "candidate") {
    throw new Error(`Only candidate skills can be promoted: ${current.status}`);
  }

  const test = await runSkillPackageTests(root);

  if (!test.passed) {
    throw new Error(
      `Skill package tests must pass before promotion:\n${formatSkillTestReport(test)}`
    );
  }

  const promotedAt = (options.now ?? new Date()).toISOString();
  const promotedBy = options.promotedBy ?? "local-admin";

  await writeSkillStatus(skillPath, "promoted");
  await appendFile(
    join(root, "changelog.md"),
    `\n- Promoted by ${promotedBy} at ${promotedAt} after tests passed.\n`,
    "utf8"
  );

  const validation = await validateSkillPackageDir(root);

  if (validation.skill === undefined) {
    throw new Error("Promoted skill package could not be reloaded");
  }

  return {
    root,
    previousStatus: "candidate",
    skill: validation.skill,
    test,
    validation
  };
}

export async function deprecateSkillPackage(
  options: DeprecateSkillPackageOptions
): Promise<DeprecateSkillPackageResult> {
  const root = resolve(options.root);
  const skillPath = join(root, "skill.yaml");
  const current = await loadSkillPackageFromFile(skillPath);

  if (current.status !== "promoted") {
    throw new Error(`Only promoted skills can be deprecated: ${current.status}`);
  }

  const deprecatedAt = (options.now ?? new Date()).toISOString();
  const deprecatedBy = options.deprecatedBy ?? "local-admin";
  const reason = options.reason ?? "manual deprecation";

  await writeSkillStatus(skillPath, "deprecated");
  await appendFile(
    join(root, "changelog.md"),
    `\n- Deprecated by ${deprecatedBy} at ${deprecatedAt}: ${reason}.\n`,
    "utf8"
  );

  const validation = await validateSkillPackageDir(root);

  if (validation.skill === undefined) {
    throw new Error("Deprecated skill package could not be reloaded");
  }

  return {
    root,
    previousStatus: "promoted",
    skill: validation.skill,
    validation
  };
}

async function writeSkillStatus(path: string, status: SkillStatus): Promise<void> {
  const document = parseYaml(await readFile(path, "utf8")) as unknown;

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("skill.yaml must contain a mapping");
  }

  const mapping = document as Record<string, unknown>;

  await writeFile(
    path,
    stringifyYaml(
      {
        ...mapping,
        status
      },
      { lineWidth: 0 }
    ),
    "utf8"
  );
}
