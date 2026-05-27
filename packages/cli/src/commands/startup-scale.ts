import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  runStartupScaleIntegrationMapCommand,
  runStartupScaleStarterPackCommand,
  runStartupScaleWorkflowRegistryCommand,
  type StartupScaleIntegrationMapCommandOptions,
  type StartupScaleStarterPackCommandOptions,
  type StartupScaleWorkflowRegistryCommandOptions
} from "./startup-scale-actions.js";
import { registerStartupScaleMemoryCommands } from "./startup-scale-memory.js";
import { registerStartupScaleOpsCommands } from "./startup-scale-ops.js";

export function registerStartupScaleCommand(startup: Command): Command {
  const startupScale = startup
    .command("scale")
    .description("Generate startup ops handoff artifacts.");

  startupScale
    .command("starter-pack")
    .description("Generate a starter pack for scale-stage operating evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--owner <id>", "Starter pack owner")
    .option("--actor <id>", "RBAC subject for scale starter generation", "local-admin")
    .action(async (options: StartupScaleStarterPackCommandOptions) =>
      runStartupScaleStarterPackCommand(options)
    );

  startupScale
    .command("workflow-registry")
    .description("Generate workflow registry and delegation policy evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--workflow <text>", "Recurring workflow to register", collectValues, [])
    .option(
      "--delegation-rule <text>",
      "Agent delegation rule to record",
      collectValues,
      []
    )
    .option(
      "--approval-boundary <text>",
      "Boundary that requires approval",
      collectValues,
      []
    )
    .option(
      "--allowed-agent <id>",
      "Agent allowed by delegation policy",
      collectValues,
      []
    )
    .option(
      "--constrained-task <type>",
      "Task type constrained by delegation policy",
      collectValues,
      []
    )
    .option(
      "--actor <id>",
      "RBAC subject for workflow registry generation",
      "local-admin"
    )
    .action(async (options: StartupScaleWorkflowRegistryCommandOptions) =>
      runStartupScaleWorkflowRegistryCommand(options)
    );

  registerStartupScaleMemoryCommands(startupScale);

  startupScale
    .command("integration-map")
    .description("Generate integration depth and automation coverage evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--integration <text>", "Customer workflow integration", collectValues, [])
    .option("--lock-in-signal <text>", "Workflow lock-in signal", collectValues, [])
    .option("--adoption-signal <text>", "Adoption signal", collectValues, [])
    .option("--workflow-signal <text>", "Workflow usage signal", collectValues, [])
    .option(
      "--automation-coverage <text>",
      "Automation coverage note",
      collectValues,
      []
    )
    .option(
      "--actor <id>",
      "RBAC subject for integration map generation",
      "local-admin"
    )
    .action(async (options: StartupScaleIntegrationMapCommandOptions) =>
      runStartupScaleIntegrationMapCommand(options)
    );

  registerStartupScaleOpsCommands(startupScale);

  return startupScale;
}
