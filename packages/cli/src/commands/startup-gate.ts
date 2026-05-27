import type { Command } from "commander";

import {
  runStartupGateCheckCommand,
  runStartupGateDecideCommand,
  runStartupGateFixtureTestCommand,
  runStartupGateWaiveCommand,
  type StartupGateCheckCommandOptions,
  type StartupGateDecideCommandOptions,
  type StartupGateFixtureTestCommandOptions,
  type StartupGateWaiveCommandOptions
} from "./startup-gate-actions.js";

export function registerStartupGateCommand(startup: Command): Command {
  const startupGate = startup
    .command("gate")
    .description("Check startup stage gates against Runstead evidence.");

  startupGate
    .command("check")
    .description("Check whether a startup stage gate passes.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to check: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for gate checks", "local-admin")
    .action((options: StartupGateCheckCommandOptions) =>
      runStartupGateCheckCommand(options)
    );

  startupGate
    .command("test")
    .description(
      "Replay startup gate fixture files against the readiness verdict engine."
    )
    .argument("<fixture>", "Startup gate fixture file or directory")
    .option("--json", "Print JSON output")
    .action((fixture: string, options: StartupGateFixtureTestCommandOptions) =>
      runStartupGateFixtureTestCommand(fixture, options)
    );

  startupGate
    .command("waive")
    .description(
      "Record a time-boxed owner-approved waiver for a startup gate blocker."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to waive: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .requiredOption("--blocker <text>", "Exact blocker text to waive")
    .requiredOption("--owner <id>", "Owner accepting the waived risk")
    .requiredOption("--reason <text>", "Reason the blocker can be accepted")
    .option("--comment <text>", "Reviewer or approver comment")
    .requiredOption("--expires-at <iso>", "Expiration timestamp for the waiver")
    .option("--actor <id>", "RBAC subject for gate decisions", "local-admin")
    .action((options: StartupGateWaiveCommandOptions) =>
      runStartupGateWaiveCommand(options)
    );

  startupGate
    .command("decide")
    .description("Record a launch/no-launch decision for a startup gate.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to decide: idea, mvp, launch, or scale", "launch")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .requiredOption(
      "--decision <value>",
      "Decision: launch, no_launch, or launch_with_accepted_debt"
    )
    .requiredOption("--reason <text>", "Decision rationale")
    .option("--owner <id>", "Decision owner")
    .option("--comment <text>", "Reviewer or approver comment")
    .option("--actor <id>", "RBAC subject for gate decisions", "local-admin")
    .action((options: StartupGateDecideCommandOptions) =>
      runStartupGateDecideCommand(options)
    );

  return startupGate;
}
