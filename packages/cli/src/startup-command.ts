import type { Command } from "commander";

import { checkPermission } from "./rbac.js";

export function registerStartupCommands(program: Command): void {
  const startup = program
    .command("startup")
    .description("Manage AI-native startup evidence and stage gates.");

  startup
    .command("init")
    .description("Initialize AI-native startup execution for a workspace.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Startup stage: mvp, launch, or scale", "mvp")
    .option(
      "--profile <profile>",
      "Policy profile to generate when Runstead is not initialized: default or trusted-local",
      "default"
    )
    .option("--force", "Upgrade installed startup pack and create a fresh startup goal")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        profile: "default" | "trusted-local";
        force?: boolean;
      }) => {
        const { initStartup } = await import("./startup-automation.js");
        const result = await initStartup({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          stage: parseStartupInitStage(options.stage),
          profile: options.profile,
          force: options.force === true
        });

        console.log(`Initialized startup execution: ${result.root}`);
        console.log(`Stage: ${result.stage}`);
        console.log(`Installed startup domain: ${result.domainInstalled}`);
        console.log(`Upgraded startup domain: ${result.domainUpgraded}`);
        console.log(
          `${result.goalCreated ? "Created" : "Reused"} goal: ${result.goal.id} ${result.goal.title}`
        );
        for (const task of result.generatedTasks) {
          console.log(`Created task: ${task.id} ${task.type}`);
        }
      }
    );

  const startupContext = startup
    .command("context")
    .description("Generate startup agent context artifacts.");

  startupContext
    .command("generate")
    .description("Generate AGENTS.md, CLAUDE.md, CODEX.md, and evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite existing context files")
    .option(
      "--architecture <text>",
      "Architecture principle to include",
      collectValues,
      []
    )
    .option("--constraint <text>", "Technical constraint to include", collectValues, [])
    .option("--accepted-debt <text>", "Accepted technical debt", collectValues, [])
    .option("--actor <id>", "RBAC subject for context generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        architecture: string[];
        constraint: string[];
        acceptedDebt: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup context"
        });

        const { generateStartupContext } = await import("./startup-automation.js");
        const architecturePrinciples = emptyAsUndefined(options.architecture);
        const technicalConstraints = emptyAsUndefined(options.constraint);
        const acceptedDebt = emptyAsUndefined(options.acceptedDebt);
        const result = await generateStartupContext({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          force: options.force === true,
          ...(architecturePrinciples === undefined ? {} : { architecturePrinciples }),
          ...(technicalConstraints === undefined ? {} : { technicalConstraints }),
          ...(acceptedDebt === undefined ? {} : { acceptedDebt })
        });

        console.log(`Generated startup context evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote context file: ${file}`);
        }
      }
    );

  const startupMeasurement = startup
    .command("measurement")
    .description("Generate startup measurement framework artifacts.");

  startupMeasurement
    .command("generate")
    .description("Generate MEASUREMENT.md and evidence-backed metric contracts.")
    .option("--cwd <path>", "Workspace directory")
    .option("--force", "Overwrite existing measurement framework")
    .option("--activation <text>", "Activation metric")
    .option("--retention <text>", "Retention metric")
    .option("--day7 <text>", "Day 7 metric")
    .option("--day30 <text>", "Day 30 metric")
    .option("--false-positive <text>", "False-positive metric")
    .option("--actor <id>", "RBAC subject for measurement generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        force?: boolean;
        activation?: string;
        retention?: string;
        day7?: string;
        day30?: string;
        falsePositive?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup measurement framework"
        });

        const { generateMeasurementFramework } =
          await import("./startup-automation.js");
        const result = await generateMeasurementFramework({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          force: options.force === true,
          ...(options.activation === undefined
            ? {}
            : { activationMetric: options.activation }),
          ...(options.retention === undefined
            ? {}
            : { retentionMetric: options.retention }),
          ...(options.day7 === undefined ? {} : { day7Metric: options.day7 }),
          ...(options.day30 === undefined ? {} : { day30Metric: options.day30 }),
          ...(options.falsePositive === undefined
            ? {}
            : { falsePositiveMetric: options.falsePositive })
        });

        console.log(`Generated measurement evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote measurement file: ${file}`);
        }
      }
    );

  const startupLaunch = startup
    .command("launch")
    .description("Generate startup launch readiness artifacts.");

  startupLaunch
    .command("audit")
    .description("Inspect repo readiness and record launch audit evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for launch audit generation", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "generate startup launch audit"
      });

      const { generateRepoReadinessAudit } = await import("./startup-automation.js");
      const result = await generateRepoReadinessAudit({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(`Generated repo readiness evidence: ${result.evidenceId}`);
      console.log(`Blockers: ${result.blockers.length}`);
      console.log(`Warnings: ${result.warnings.length}`);
      for (const file of result.files) {
        console.log(`Wrote launch audit file: ${file}`);
      }
    });

  startupLaunch
    .command("security-baseline")
    .description("Record protected-path, env, and dependency baseline evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--actor <id>",
      "RBAC subject for security baseline generation",
      "local-admin"
    )
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "generate startup security baseline"
      });

      const { generateSecurityBaseline } = await import("./startup-automation.js");
      const result = await generateSecurityBaseline({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(`Generated security baseline evidence: ${result.evidenceId}`);
      console.log(`Blockers: ${result.blockers.length}`);
      console.log(`Warnings: ${result.warnings.length}`);
      for (const file of result.files) {
        console.log(`Wrote security baseline file: ${file}`);
      }
    });

  startupLaunch
    .command("support-triage")
    .description("Record evidence-backed support triage for launch readiness.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--request <text>", "Support request or issue summary")
    .requiredOption("--outcome <text>", "Triage outcome and next action")
    .option("--customer <text>", "Customer or account identifier")
    .option("--severity <level>", "Severity label", "medium")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--actor <id>", "RBAC subject for support triage writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        request: string;
        outcome: string;
        customer?: string;
        severity: string;
        source: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup support triage"
        });

        const { recordSupportTriage } = await import("./startup-automation.js");
        const result = await recordSupportTriage({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          request: options.request,
          outcome: options.outcome,
          ...(options.customer === undefined ? {} : { customer: options.customer }),
          severity: options.severity,
          sourceRefs: options.source
        });

        console.log(`Recorded support triage evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote support triage file: ${file}`);
        }
      }
    );

  startupLaunch
    .command("bottleneck-map")
    .description("Generate founder bottleneck audit evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--bottleneck <text>",
      "Founder-only bottleneck to record",
      collectValues,
      []
    )
    .option("--owner <text>", "Handoff owner")
    .option("--system-of-record <text>", "Durable system of record")
    .option("--actor <id>", "RBAC subject for bottleneck audit writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        bottleneck: string[];
        owner?: string;
        systemOfRecord?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate founder bottleneck map"
        });

        const { generateFounderBottleneckMap } =
          await import("./startup-automation.js");
        const result = await generateFounderBottleneckMap({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          bottlenecks: options.bottleneck,
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.systemOfRecord === undefined
            ? {}
            : { systemOfRecord: options.systemOfRecord })
        });

        console.log(`Generated founder bottleneck evidence: ${result.evidenceId}`);
        console.log(`Bottlenecks: ${result.bottlenecks.length}`);
        for (const file of result.files) {
          console.log(`Wrote bottleneck map file: ${file}`);
        }
      }
    );

  const startupScale = startup
    .command("scale")
    .description("Generate startup ops handoff artifacts.");

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
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup workflow registry"
        });

        const { generateWorkflowRegistry } = await import("./startup-automation.js");
        const result = await generateWorkflowRegistry({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          workflows: options.workflow,
          delegationRules: options.delegationRule,
          approvalBoundaries: options.approvalBoundary
        });

        console.log(`Generated workflow evidence: ${result.evidenceIds.join(", ")}`);
        console.log(`Workflows: ${result.workflows.length}`);
        console.log(`Delegation rules: ${result.delegationRules.length}`);
        for (const file of result.files) {
          console.log(`Wrote scale artifact: ${file}`);
        }
      }
    );

  startupScale
    .command("memory-capture")
    .description("Capture founder-only knowledge as memory and evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--knowledge <text>",
      "Founder-only knowledge to capture",
      collectValues,
      []
    )
    .option("--scope <scope>", "Memory scope", "startup/institutional-memory")
    .option("--source <ref>", "Source reference", collectValues, [])
    .option("--actor <id>", "RBAC subject for memory capture", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        knowledge: string[];
        scope: string;
        source: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.write",
          action: "capture startup institutional memory"
        });
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup institutional memory evidence"
        });

        const { captureInstitutionalMemory } = await import("./startup-automation.js");
        const result = await captureInstitutionalMemory({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          knowledge: options.knowledge,
          scope: options.scope,
          sourceRefs: options.source
        });

        console.log(`Captured institutional memory: ${result.memoryId}`);
        console.log(`Recorded memory evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote memory artifact: ${file}`);
        }
      }
    );

  startupScale
    .command("integration-map")
    .description("Generate integration depth and automation coverage evidence.")
    .option("--cwd <path>", "Workspace directory")
    .option("--integration <text>", "Customer workflow integration", collectValues, [])
    .option("--lock-in-signal <text>", "Workflow lock-in signal", collectValues, [])
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
        automationCoverage: string[];
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "generate startup integration depth map"
        });

        const { generateIntegrationMap } = await import("./startup-automation.js");
        const result = await generateIntegrationMap({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          integrations: options.integration,
          lockInSignals: options.lockInSignal,
          automationCoverage: options.automationCoverage
        });

        console.log(`Generated integration map evidence: ${result.evidenceId}`);
        console.log(`Integrations: ${result.integrations.length}`);
        for (const file of result.files) {
          console.log(`Wrote integration map file: ${file}`);
        }
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

      const { generateScaleOpsReport } = await import("./startup-automation.js");
      const result = await generateScaleOpsReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.period === undefined ? {} : { period: options.period })
      });

      console.log(`Generated scale ops report evidence: ${result.evidenceId}`);
      console.log(`Period: ${result.period}`);
      for (const file of result.files) {
        console.log(`Wrote scale report file: ${file}`);
      }
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

        const { generateOpsSops } = await import("./startup-automation.js");
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

        const { verifyGtmArtifacts } = await import("./startup-automation.js");
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
      }
    );

  const startupHypothesis = startup
    .command("hypothesis")
    .description("Manage startup hypothesis ledger records.");

  startupHypothesis
    .command("add")
    .description("Add a problem, user, or solution hypothesis.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--kind <kind>", "Hypothesis kind: problem, user, or solution")
    .requiredOption("--statement <text>", "Hypothesis statement")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for hypothesis writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        kind: string;
        statement: string;
        source: string[];
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "write startup hypotheses"
        });

        const { addStartupHypothesis } = await import("./startup-evidence.js");
        const result = await addStartupHypothesis({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          kind: parseStartupHypothesisKind(options.kind),
          statement: options.statement,
          sourceRefs: options.source,
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Recorded startup hypothesis: ${result.evidence.id}`);
        console.log(`Type: ${result.evidence.type}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  const startupEvidence = startup
    .command("evidence")
    .description("Manage founder evidence ledger records.");

  startupEvidence
    .command("add")
    .description("Add customer, competitor, metric, hypothesis, or decision evidence.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--type <type>",
      "Evidence type: customer_interview, competitor, metric, measurement_framework, agent_context, repo_readiness, security_baseline, migration_plan, rollback_plan, release_plan, hypothesis, problem_hypothesis, user_hypothesis, solution_hypothesis, disconfirming, support_triage, founder_bottleneck, workflow_registry, delegation_policy, institutional_memory, ops_report, integration_map, ops_sop, gtm_artifact, decision, acceptable_debt, or observability"
    )
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--content <text>", "Optional evidence body")
    .option("--goal <id>", "Associated goal id")
    .option("--hypothesis <id>", "Associated hypothesis id")
    .option("--decision <id>", "Associated decision id")
    .option("--actor <id>", "RBAC subject for evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        type: string;
        summary: string;
        source: string[];
        content?: string;
        goal?: string;
        hypothesis?: string;
        decision?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "write startup evidence"
        });

        const { addStartupEvidence } = await import("./startup-evidence.js");
        const result = await addStartupEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          type: options.type,
          summary: options.summary,
          sourceRefs: options.source,
          ...(options.content === undefined ? {} : { content: options.content }),
          ...(options.goal === undefined ? {} : { goalId: options.goal }),
          ...(options.hypothesis === undefined
            ? {}
            : { hypothesisId: options.hypothesis }),
          ...(options.decision === undefined ? {} : { decisionId: options.decision })
        });

        console.log(`Recorded startup evidence: ${result.evidence.id}`);
        console.log(`Type: ${result.evidence.type}`);
        console.log(
          `Subject: ${result.evidence.subjectType} ${result.evidence.subjectId}`
        );
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

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
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.read",
          action: "check startup gates"
        });

        const { checkStartupGate, formatStartupGateCheckResult } =
          await import("./startup-evidence.js");
        const result = await checkStartupGate({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage)
        });

        console.log(formatStartupGateCheckResult(result));

        if (!result.passed) {
          process.exitCode = 1;
        }
      }
    );
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function emptyAsUndefined(values: string[]): string[] | undefined {
  return values.length === 0 ? undefined : values;
}

function parseStartupGateStage(value: string): "idea" | "mvp" | "launch" | "scale" {
  if (value === "idea" || value === "mvp" || value === "launch" || value === "scale") {
    return value;
  }

  throw new Error("--stage must be one of: idea, mvp, launch, scale");
}

function parseStartupInitStage(value: string): "mvp" | "launch" | "scale" {
  if (value === "mvp" || value === "launch" || value === "scale") {
    return value;
  }

  throw new Error("--stage must be one of: mvp, launch, scale");
}

function parseStartupHypothesisKind(value: string): "problem" | "user" | "solution" {
  if (value === "problem" || value === "user" || value === "solution") {
    return value;
  }

  throw new Error("--kind must be one of: problem, user, solution");
}

async function requireRbacPermission(options: {
  cwd?: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const result = await checkPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    subject: options.actor,
    permission: options.permission
  });

  if (result.decision !== "allow") {
    throw new Error(
      `Subject ${options.actor} cannot ${options.action}: ${result.reason}`
    );
  }
}
