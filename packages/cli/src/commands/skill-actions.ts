import { join } from "node:path";

export interface SkillCandidateCreateCommandOptions {
  description: string;
  dir?: string;
  domain: string;
  trigger: string[];
  allowedTool: string[];
  deniedTool: string[];
  verifierCommand: string[];
  task: string[];
  scopeRepo: string[];
  author?: string;
}

export interface SkillPromoteCommandOptions {
  promotedBy: string;
}

export interface SkillDeprecateCommandOptions {
  deprecatedBy: string;
  reason?: string;
}

export interface SkillActivationListCommandOptions {
  cwd?: string;
}

export interface SkillActivationDeactivateCommandOptions {
  cwd?: string;
  disabledBy: string;
  reason?: string;
}

export async function runSkillCandidateCreateCommand(
  name: string,
  options: SkillCandidateCreateCommandOptions
): Promise<void> {
  const { createSkillCandidatePackage, formatSkillValidationReport } =
    await import("@runstead/skills");
  const result = await createSkillCandidatePackage({
    root: options.dir ?? join(process.cwd(), "skills", name),
    name,
    domain: options.domain,
    description: options.description,
    triggers: options.trigger,
    allowedTools: options.allowedTool,
    deniedTools: options.deniedTool,
    verifierCommands: options.verifierCommand,
    provenanceTasks: options.task,
    ...(options.scopeRepo.length === 0 ? {} : { scopeRepos: options.scopeRepo }),
    ...(options.author === undefined ? {} : { author: options.author })
  });

  console.log(`Created skill candidate: ${result.root}`);
  console.log(formatSkillValidationReport(result.validation));

  if (!result.validation.valid) {
    process.exitCode = 1;
  }
}

export async function runSkillValidateCommand(path: string): Promise<void> {
  const { formatSkillValidationReport, validateSkillPackageDir } =
    await import("@runstead/skills");
  const result = await validateSkillPackageDir(path);

  console.log(formatSkillValidationReport(result));

  if (!result.valid) {
    process.exitCode = 1;
  }
}

export async function runSkillTestCommand(path: string): Promise<void> {
  const { formatSkillTestReport, runSkillPackageTests } =
    await import("@runstead/skills");
  const result = await runSkillPackageTests(path);

  console.log(formatSkillTestReport(result));

  if (!result.passed) {
    process.exitCode = 1;
  }
}

export async function runSkillPromoteCommand(
  path: string,
  options: SkillPromoteCommandOptions
): Promise<void> {
  const { formatSkillTestReport, formatSkillValidationReport, promoteSkillPackage } =
    await import("@runstead/skills");
  const result = await promoteSkillPackage({
    root: path,
    promotedBy: options.promotedBy
  });

  console.log(`Promoted skill package: ${result.root}`);
  console.log(formatSkillTestReport(result.test));
  console.log(formatSkillValidationReport(result.validation));
}

export async function runSkillDeprecateCommand(
  path: string,
  options: SkillDeprecateCommandOptions
): Promise<void> {
  const { deprecateSkillPackage, formatSkillValidationReport } =
    await import("@runstead/skills");
  const result = await deprecateSkillPackage({
    root: path,
    deprecatedBy: options.deprecatedBy,
    ...(options.reason === undefined ? {} : { reason: options.reason })
  });

  console.log(`Deprecated skill package: ${result.root}`);
  console.log(formatSkillValidationReport(result.validation));
}

export async function runSkillActivationListCommand(
  options: SkillActivationListCommandOptions
): Promise<void> {
  const { requireRunsteadRootSync } = await import("../runstead-root.js");
  const { loadSkillActivationRegistry } = await import("../skill-activations.js");
  const root = requireRunsteadRootSync(options.cwd).root;
  const registry = loadSkillActivationRegistry(root);

  if (registry.activations.length === 0) {
    console.log("No skill activations found.");
    return;
  }

  for (const activation of registry.activations) {
    console.log(
      [
        `${activation.id} ${activation.status} ${activation.name}@${activation.version} risk=${activation.risk} canary=${activation.canaryPercent}%`,
        `  root: ${activation.skillRoot}`,
        `  scope_repos: ${activation.scope.repos.join(", ") || "all"}`,
        `  rollback_on_regression: ${activation.rollbackOnRegression ? "yes" : "no"}`,
        `  updated_at: ${activation.updatedAt}`,
        ...(activation.disabledReason === undefined
          ? []
          : [`  disabled_reason: ${activation.disabledReason}`])
      ].join("\n")
    );
  }
}

export async function runSkillActivationDeactivateCommand(
  activationId: string,
  options: SkillActivationDeactivateCommandOptions
): Promise<void> {
  const { requireRunsteadRootSync, requireRunsteadStateDbSync } =
    await import("../runstead-root.js");
  const { openRunsteadDatabase } = await import("@runstead/state-sqlite");
  const { deactivateSkillActivation } = await import("../skill-activations.js");
  const root = requireRunsteadRootSync(options.cwd).root;
  const stateDb = requireRunsteadStateDbSync(options.cwd).stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const activation = deactivateSkillActivation({
      root,
      database,
      activationId,
      disabledBy: options.disabledBy,
      ...(options.reason === undefined ? {} : { reason: options.reason })
    });

    console.log(`Deactivated skill activation: ${activation.id}`);
    console.log(`Skill: ${activation.name}@${activation.version}`);
    console.log(`Reason: ${activation.disabledReason ?? "manual deactivation"}`);
  } finally {
    database.close();
  }
}
