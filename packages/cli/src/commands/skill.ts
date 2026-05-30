import type { Command } from "commander";

import { collectValues } from "../cli-parsers.js";
import {
  runSkillCandidateCreateCommand,
  runSkillActivationDeactivateCommand,
  runSkillActivationListCommand,
  runSkillDeprecateCommand,
  runSkillPromoteCommand,
  runSkillTestCommand,
  runSkillValidateCommand,
  type SkillActivationDeactivateCommandOptions,
  type SkillActivationListCommandOptions,
  type SkillCandidateCreateCommandOptions,
  type SkillDeprecateCommandOptions,
  type SkillPromoteCommandOptions
} from "./skill-actions.js";

export function registerSkillCommand(program: Command): Command {
  const skill = program
    .command("skill")
    .description("Manage skill packages. Experimental.");

  const skillCandidate = skill
    .command("candidate")
    .description("Manage skill candidates.");
  const skillActivation = skill
    .command("activation")
    .description("Manage experimental activated promoted skills.");

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
    .action((name: string, options: SkillCandidateCreateCommandOptions) =>
      runSkillCandidateCreateCommand(name, options)
    );

  skillActivation
    .command("list")
    .description("List experimental activated skill packages for a workspace.")
    .option("--cwd <path>", "Workspace directory")
    .action((options: SkillActivationListCommandOptions) =>
      runSkillActivationListCommand(options)
    );

  skillActivation
    .command("deactivate")
    .description("Disable an experimental activated skill package.")
    .argument("<activation-id>", "Skill activation id")
    .option("--cwd <path>", "Workspace directory")
    .option("--disabled-by <id>", "Deactivator identity", "local-admin")
    .option("--reason <text>", "Deactivation reason")
    .action((activationId: string, options: SkillActivationDeactivateCommandOptions) =>
      runSkillActivationDeactivateCommand(activationId, options)
    );

  skill
    .command("validate")
    .description("Validate a Runstead skill package directory.")
    .argument("<path>", "Skill package directory")
    .action((path: string) => runSkillValidateCommand(path));

  skill
    .command("test")
    .description("Validate and run a skill package test script.")
    .argument("<path>", "Skill package directory")
    .action((path: string) => runSkillTestCommand(path));

  skill
    .command("promote")
    .description("Promote a candidate skill package after validation and tests pass.")
    .argument("<path>", "Skill package directory")
    .option("--promoted-by <id>", "Promoter identity", "local-admin")
    .action((path: string, options: SkillPromoteCommandOptions) =>
      runSkillPromoteCommand(path, options)
    );

  skill
    .command("deprecate")
    .description("Deprecate a promoted skill package.")
    .argument("<path>", "Skill package directory")
    .option("--deprecated-by <id>", "Deprecator identity", "local-admin")
    .option("--reason <text>", "Deprecation reason")
    .action((path: string, options: SkillDeprecateCommandOptions) =>
      runSkillDeprecateCommand(path, options)
    );

  return skill;
}
