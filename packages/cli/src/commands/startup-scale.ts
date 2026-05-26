import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";
import { registerStartupScaleMemoryCommands } from "./startup-scale-memory.js";
import { registerStartupScaleOpsCommands } from "./startup-scale-ops.js";
import { logStructuredFiles } from "./startup-scale-output.js";

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
    .action(async (options: { cwd?: string; owner?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "generate startup scale starter pack"
      });

      const { generateScaleStarterPack } = await import("../startup-automation.js");
      const result = await generateScaleStarterPack({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.owner === undefined ? {} : { owner: options.owner })
      });

      console.log(`Generated scale starter evidence: ${result.evidenceIds[0]}`);
      console.log(`Scale-ready: ${result.scaleReady ? "yes" : "no"}`);
      console.log(`Blockers: ${result.blockers.length}`);
      for (const file of result.files) {
        console.log(`Wrote scale starter file: ${file}`);
      }
      logStructuredFiles(result.structuredFiles);
    });

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
    .action(
      async (options: {
        cwd?: string;
        workflow: string[];
        delegationRule: string[];
        approvalBoundary: string[];
        allowedAgent: string[];
        constrainedTask: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup workflow registry"
        });

        const { generateWorkflowRegistry } = await import("../startup-automation.js");
        const result = await generateWorkflowRegistry({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          workflows: options.workflow,
          delegationRules: options.delegationRule,
          approvalBoundaries: options.approvalBoundary,
          allowedAgents: options.allowedAgent,
          constrainedTaskTypes: options.constrainedTask
        });

        console.log(`Generated workflow evidence: ${result.evidenceIds.join(", ")}`);
        console.log(`Workflows: ${result.workflows.length}`);
        console.log(`Delegation rules: ${result.delegationRules.length}`);
        for (const file of result.files) {
          console.log(`Wrote scale artifact: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
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
    .action(
      async (options: {
        cwd?: string;
        integration: string[];
        lockInSignal: string[];
        adoptionSignal: string[];
        workflowSignal: string[];
        automationCoverage: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup integration depth map"
        });

        const { generateIntegrationMap } = await import("../startup-automation.js");
        const result = await generateIntegrationMap({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          integrations: options.integration,
          lockInSignals: options.lockInSignal,
          automationCoverage: options.automationCoverage,
          adoptionSignals: options.adoptionSignal,
          workflowSignals: options.workflowSignal
        });

        console.log(`Generated integration map evidence: ${result.evidenceId}`);
        console.log(`Integrations: ${result.integrations.length}`);
        for (const file of result.files) {
          console.log(`Wrote integration map file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  registerStartupScaleOpsCommands(startupScale);

  return startupScale;
}
