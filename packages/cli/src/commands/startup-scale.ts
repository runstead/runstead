import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";
import { registerStartupScaleMemoryCommands } from "./startup-scale-memory.js";
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

  startupScale
    .command("schedule-report")
    .description("Record the recurring scale report schedule.")
    .option("--cwd <path>", "Workspace directory")
    .option("--cadence <cadence>", "Schedule cadence", "weekly")
    .option("--owner <id>", "Schedule owner")
    .option("--next-run <date>", "Next run date or timestamp")
    .option("--period-template <template>", "Period template", "YYYY-WW")
    .option("--actor <id>", "RBAC subject for schedule writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        cadence: string;
        owner?: string;
        nextRun?: string;
        periodTemplate: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup scale report schedule"
        });

        const { scheduleScaleReport } = await import("../startup-automation.js");
        const result = await scheduleScaleReport({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          cadence: options.cadence,
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.nextRun === undefined ? {} : { nextRunAt: options.nextRun }),
          periodTemplate: options.periodTemplate
        });

        console.log(`Recorded scale report schedule evidence: ${result.evidenceId}`);
        console.log(`Next command: ${result.nextCommand}`);
        for (const file of result.files) {
          console.log(`Wrote schedule file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  startupScale
    .command("report")
    .description("Generate recurring ops, engineering, and GTM evidence report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--period <label>", "Report period label")
    .option("--actor <id>", "RBAC subject for scale report generation", "local-admin")
    .action(async (options: { cwd?: string; period?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "generate startup scale ops report"
      });

      const { generateScaleOpsReport } = await import("../startup-automation.js");
      const result = await generateScaleOpsReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.period === undefined ? {} : { period: options.period })
      });

      console.log(`Generated scale ops report evidence: ${result.evidenceId}`);
      console.log(`Period: ${result.period}`);
      for (const file of result.files) {
        console.log(`Wrote scale report file: ${file}`);
      }
      logStructuredFiles(result.structuredFiles);
    });

  startupScale
    .command("sop-generate")
    .description("Generate handoff-ready SOP artifacts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--sop <text>", "SOP step or contract to record", collectValues, [])
    .option("--owner <text>", "SOP owner")
    .option("--workflow <text>", "Associated workflow")
    .option("--actor <id>", "RBAC subject for SOP generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        sop: string[];
        owner?: string;
        workflow?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup ops SOPs"
        });

        const { generateOpsSops } = await import("../startup-automation.js");
        const result = await generateOpsSops({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          sops: options.sop,
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.workflow === undefined ? {} : { workflow: options.workflow })
        });

        console.log(`Generated SOP evidence: ${result.evidenceId}`);
        console.log(`SOPs: ${result.sops.length}`);
        for (const file of result.files) {
          console.log(`Wrote SOP file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  startupScale
    .command("gtm-verify")
    .description("Verify GTM claims against evidence and product state.")
    .option("--cwd <path>", "Workspace directory")
    .option("--claim <text>", "External GTM claim to verify", collectValues, [])
    .option("--evidence <ref>", "Evidence reference for the claim", collectValues, [])
    .option("--product-state <text>", "Current product state")
    .option("--actor <id>", "RBAC subject for GTM verification", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        claim: string[];
        evidence: string[];
        productState?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "verify startup GTM artifacts"
        });

        const { verifyGtmArtifacts } = await import("../startup-automation.js");
        const result = await verifyGtmArtifacts({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          claims: options.claim,
          evidenceRefs: options.evidence,
          ...(options.productState === undefined
            ? {}
            : { productState: options.productState })
        });

        console.log(`Generated GTM verification evidence: ${result.evidenceId}`);
        console.log(`Claims: ${result.claims.length}`);
        for (const file of result.files) {
          console.log(`Wrote GTM verification file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
      }
    );

  return startupScale;
}
