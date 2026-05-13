import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type { SkillPackageValidationResult } from "./validator.js";
import { validateSkillPackageDir } from "./validator.js";

export interface CreateSkillCandidateOptions {
  root: string;
  name: string;
  domain: string;
  description: string;
  triggers: string[];
  allowedTools: string[];
  deniedTools: string[];
  verifierCommands: string[];
  provenanceTasks: string[];
  author?: string;
  scopeRepos?: string[];
  permissions?: Record<string, string>;
}

export interface CreateSkillCandidateResult {
  root: string;
  validation: SkillPackageValidationResult;
}

export async function createSkillCandidatePackage(
  options: CreateSkillCandidateOptions
): Promise<CreateSkillCandidateResult> {
  validateCandidateOptions(options);

  const root = resolve(options.root);

  if (await exists(join(root, "skill.yaml"))) {
    throw new Error(`Skill candidate already exists: ${root}`);
  }

  await mkdir(join(root, "tests", "fixtures"), { recursive: true });
  await mkdir(join(root, "evals"), { recursive: true });
  await mkdir(join(root, "examples"), { recursive: true });

  const skillYaml = stringifyYaml(
    {
      name: options.name,
      version: "0.1.0",
      status: "candidate",
      domain: options.domain,
      description: options.description,
      triggers: options.triggers,
      ...(options.scopeRepos === undefined || options.scopeRepos.length === 0
        ? {}
        : {
            scope: {
              repos: options.scopeRepos
            }
          }),
      allowed_tools: options.allowedTools,
      denied_tools: options.deniedTools,
      permissions: options.permissions ?? defaultPermissions(),
      verifiers: options.verifierCommands.map((command) => ({ command })),
      provenance: {
        created_from_tasks: options.provenanceTasks,
        author: options.author ?? "agent-curator"
      }
    },
    {
      lineWidth: 0
    }
  );

  await writeFile(join(root, "skill.yaml"), skillYaml, "utf8");
  await writeFile(join(root, "SKILL.md"), skillMarkdown(options), "utf8");
  await writeFile(
    join(root, "permissions.yaml"),
    stringifyYaml(options.permissions ?? defaultPermissions(), { lineWidth: 0 }),
    "utf8"
  );
  await writeFile(join(root, "tests", "run.sh"), testScript(options), "utf8");
  await chmod(join(root, "tests", "run.sh"), 0o755);
  await writeFile(
    join(root, "evals", "benchmark.yaml"),
    stringifyYaml({ benchmarks: [] }, { lineWidth: 0 }),
    "utf8"
  );
  await writeFile(join(root, "examples", "before.md"), "# Before\n", "utf8");
  await writeFile(join(root, "examples", "after.md"), "# After\n", "utf8");
  await writeFile(
    join(root, "changelog.md"),
    "# Changelog\n\n- Candidate created.\n",
    "utf8"
  );
  await writeFile(join(root, "rollback.md"), rollbackMarkdown(options), "utf8");

  return {
    root,
    validation: await validateSkillPackageDir(root)
  };
}

function validateCandidateOptions(options: CreateSkillCandidateOptions): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.name)) {
    throw new Error("Skill candidate name must use lowercase kebab-case");
  }

  if (basename(options.root) !== options.name) {
    throw new Error("Skill candidate root directory must end with the skill name");
  }

  requireNonEmpty(options.triggers, "triggers");
  requireNonEmpty(options.allowedTools, "allowed tools");
  requireNonEmpty(options.deniedTools, "denied tools");
  requireNonEmpty(options.verifierCommands, "verifier commands");
  requireNonEmpty(options.provenanceTasks, "provenance tasks");
}

function requireNonEmpty(values: string[], label: string): void {
  if (values.length === 0) {
    throw new Error(`Skill candidate requires ${label}`);
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

function defaultPermissions(): Record<string, string> {
  return {
    network: "deny_by_default",
    dependency_install: "approval_required"
  };
}

function skillMarkdown(options: CreateSkillCandidateOptions): string {
  return [
    `# ${options.name}`,
    "",
    options.description,
    "",
    "## Operating Boundaries",
    "",
    "- Keep changes inside the declared skill scope.",
    "- Do not broaden permissions without human review.",
    "- Run the declared verifiers before proposing promotion.",
    ""
  ].join("\n");
}

function rollbackMarkdown(options: CreateSkillCandidateOptions): string {
  return [
    "# Rollback",
    "",
    `Remove or disable the ${options.name} skill package, then re-run the affected task without this skill.`,
    ""
  ].join("\n");
}

function testScript(options: CreateSkillCandidateOptions): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "",
    ...options.verifierCommands.map(
      (command) => `printf '%s\\n' 'verifier: ${shellSingleQuote(command)}'`
    ),
    ""
  ].join("\n");
}

function shellSingleQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
