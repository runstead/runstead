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
