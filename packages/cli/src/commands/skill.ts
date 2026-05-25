import { join } from "node:path";

import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";

export function registerSkillCommand(program: Command): Command {
  const skill = program
    .command("skill")
    .description("Manage skill packages. Experimental.");

  const skillCandidate = skill
    .command("candidate")
    .description("Manage skill candidates.");

  skillCandidate
    .command("create")
    .description("Create a candidate skill package scaffold.")
    .argument("<name>", "Skill package name in lowercase kebab-case")
    .requiredOption("--description <text>", "Skill description")
    .option("--dir <path>", "Skill package root directory")
    .option("--domain <domain>", "Skill domain", "repo-maintenance")
    .option("--trigger <trigger>", "Skill trigger", collectValues, [])
    .option("--allowed-tool <tool>", "Allowed tool contract", collectValues, [])
    .option("--denied-tool <tool>", "Denied tool contract", collectValues, [])
    .option("--verifier-command <command>", "Verifier command", collectValues, [])
    .option("--task <id>", "Provenance task id", collectValues, [])
    .option("--scope-repo <repo>", "Scoped repository", collectValues, [])
    .option("--author <id>", "Skill candidate author")
    .action(
      async (
        name: string,
        options: {
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
      ) => {
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
    );

  skill
    .command("validate")
    .description("Validate a Runstead skill package directory.")
    .argument("<path>", "Skill package directory")
    .action(async (path: string) => {
      const { formatSkillValidationReport, validateSkillPackageDir } =
        await import("@runstead/skills");
      const result = await validateSkillPackageDir(path);

      console.log(formatSkillValidationReport(result));

      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  skill
    .command("test")
    .description("Validate and run a skill package test script.")
    .argument("<path>", "Skill package directory")
    .action(async (path: string) => {
      const { formatSkillTestReport, runSkillPackageTests } =
        await import("@runstead/skills");
      const result = await runSkillPackageTests(path);

      console.log(formatSkillTestReport(result));

      if (!result.passed) {
        process.exitCode = 1;
      }
    });

  skill
    .command("promote")
    .description("Promote a candidate skill package after validation and tests pass.")
    .argument("<path>", "Skill package directory")
    .option("--promoted-by <id>", "Promoter identity", "local-admin")
    .action(async (path: string, options: { promotedBy: string }) => {
      const {
        formatSkillTestReport,
        formatSkillValidationReport,
        promoteSkillPackage
      } = await import("@runstead/skills");
      const result = await promoteSkillPackage({
        root: path,
        promotedBy: options.promotedBy
      });

      console.log(`Promoted skill package: ${result.root}`);
      console.log(formatSkillTestReport(result.test));
      console.log(formatSkillValidationReport(result.validation));
    });

  skill
    .command("deprecate")
    .description("Deprecate a promoted skill package.")
    .argument("<path>", "Skill package directory")
    .option("--deprecated-by <id>", "Deprecator identity", "local-admin")
    .option("--reason <text>", "Deprecation reason")
    .action(
      async (path: string, options: { deprecatedBy: string; reason?: string }) => {
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
    );

  return skill;
}
