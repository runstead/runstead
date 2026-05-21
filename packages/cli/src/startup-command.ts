import type { Command } from "commander";

import { checkPermission } from "./rbac.js";
import type { StartupEvidenceSourceInput } from "./startup-evidence.js";

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

  startup
    .command("assess")
    .description("Assess startup gates across MVP, launch, and scale.")
    .option("--cwd <path>", "Workspace directory")
    .option("--stage <stage>", "Stage to assess: all, mvp, launch, or scale", "all")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for assessment", "local-admin")
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
          action: "assess startup gates"
        });

        const { checkStartupGate } = await import("./startup-evidence.js");
        const stages = parseStartupAssessStages(options.stage);
        const results = [];

        for (const stage of stages) {
          results.push(
            await checkStartupGate({
              ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
              domain: options.domain,
              stage
            })
          );
        }

        console.log("Startup assessment:");
        for (const result of results) {
          console.log(
            `- ${result.stage}: ${result.passed ? "passed" : "blocked"} (${result.blockers.length} blocker${result.blockers.length === 1 ? "" : "s"})`
          );
        }
      }
    );

  startup
    .command("onboard")
    .description("Run the short founder onboarding path for an AI-coded MVP repo.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--profile <profile>",
      "Policy profile to generate when Runstead is not initialized: default or trusted-local",
      "trusted-local"
    )
    .option("--force", "Overwrite generated context and measurement artifacts")
    .action(
      async (options: {
        cwd?: string;
        profile: "default" | "trusted-local";
        force?: boolean;
      }) => {
        const { formatStartupOnboard, startupOnboard } =
          await import("./startup-founder-flow.js");
        const result = await startupOnboard({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          profile: options.profile,
          force: options.force === true
        });

        console.log(formatStartupOnboard(result));
      }
    );

  startup
    .command("build-mvp")
    .description("Run the short founder MVP build path with a local agent worker.")
    .option("--cwd <path>", "Workspace directory")
    .option("--worker <worker>", "Worker: codex_direct, codex_cli, or claude_code", "codex_cli")
    .option("--model <model>", "Model override for worker execution")
    .option("--prompt <text>", "Override the default MVP build prompt")
    .action(
      async (options: {
        cwd?: string;
        worker: string;
        model?: string;
        prompt?: string;
      }) => {
        const { formatStartupBuildMvp, startupBuildMvp } =
          await import("./startup-founder-flow.js");
        const result = await startupBuildMvp({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          worker: parseLocalAgentWorker(options.worker),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.prompt === undefined ? {} : { prompt: options.prompt })
        });

        console.log(formatStartupBuildMvp(result));
      }
    );

  startup
    .command("launch-check")
    .description("Run the short founder launch readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatStartupLaunchCheck, startupLaunchCheck } =
        await import("./startup-founder-flow.js");
      const result = await startupLaunchCheck({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupLaunchCheck(result));
    });

  startup
    .command("scale-check")
    .description("Run the short founder scale readiness check path.")
    .option("--cwd <path>", "Workspace directory")
    .action(async (options: { cwd?: string }) => {
      const { formatStartupScaleCheck, startupScaleCheck } =
        await import("./startup-founder-flow.js");
      const result = await startupScaleCheck({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupScaleCheck(result));
    });

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
        logStructuredFiles(result.structuredFiles);
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
        logStructuredFiles(result.structuredFiles);
      }
    );

  startupMeasurement
    .command("snapshot")
    .description("Record a metric snapshot from analytics, query, CSV, or manual data.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--metric <name>",
      "Metric name, such as activation or d7_retention"
    )
    .requiredOption(
      "--source <source>",
      "Metric source, such as PostHog, SQL, CSV, or manual"
    )
    .requiredOption("--threshold <value>", "Launch threshold for the metric")
    .requiredOption("--current <value>", "Current metric value")
    .option("--source-ref <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical analytics, query, CSV, or BI source URI")
    .option("--source-kind <kind>", "Source kind, such as posthog, sql, csv, or manual")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--unit <unit>", "Metric unit")
    .option("--window <window>", "Measurement window")
    .option("--date <date>", "Snapshot date or timestamp")
    .option(
      "--false-positive <text>",
      "False-positive control or observed false-positive record"
    )
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for metric snapshot writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        metric: string;
        source: string;
        threshold: string;
        current: string;
        sourceRef: string[];
        sourceUri?: string;
        sourceKind?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        unit?: string;
        window?: string;
        date?: string;
        falsePositive?: string;
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record startup metric snapshot"
        });

        const { recordStartupMetricSnapshot } = await import("./startup-metrics.js");
        const result = await recordStartupMetricSnapshot({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          metric: options.metric,
          source: options.source,
          threshold: options.threshold,
          current: options.current,
          sourceRefs: options.sourceRef,
          ...evidenceSourceDetails(options),
          ...(options.unit === undefined ? {} : { unit: options.unit }),
          ...(options.window === undefined ? {} : { window: options.window }),
          ...(options.date === undefined ? {} : { snapshotDate: options.date }),
          ...(options.falsePositive === undefined
            ? {}
            : { falsePositive: options.falsePositive }),
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(
          `Recorded metric snapshot evidence: ${result.metricEvidence.evidence.id}`
        );
        console.log(`Artifact: ${result.metricEvidence.artifactPath}`);
        if (result.falsePositiveEvidence !== undefined) {
          console.log(
            `Recorded false-positive evidence: ${result.falsePositiveEvidence.evidence.id}`
          );
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
      logStructuredFiles(result.structuredFiles);
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
      logStructuredFiles(result.structuredFiles);
    });

  startupLaunch
    .command("prepare")
    .description("Prepare launch readiness artifacts and generate a readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--actor <id>", "RBAC subject for launch preparation", "local-admin")
    .action(async (options: { cwd?: string; domain: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.write",
        action: "prepare startup launch readiness"
      });
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "audit.read",
        action: "generate startup launch readiness report"
      });

      const { generateRepoReadinessAudit, generateSecurityBaseline } =
        await import("./startup-automation.js");
      const { generateLaunchReadinessReport } =
        await import("./launch-readiness-report.js");
      const readiness = await generateRepoReadinessAudit({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });
      const security = await generateSecurityBaseline({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });
      const report = await generateLaunchReadinessReport({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        domain: options.domain
      });

      console.log(`Prepared repo readiness evidence: ${readiness.evidenceId}`);
      console.log(`Prepared security baseline evidence: ${security.evidenceId}`);
      console.log(`Generated launch readiness report: ${report.reportPath}`);
      console.log(`Status: ${report.status}`);
      console.log(`Blockers: ${report.blockers.length}`);
    });

  startupLaunch
    .command("report")
    .description("Generate the startup launch readiness report.")
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for report generation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        domain: string;
        print?: boolean;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "audit.read",
          action: "generate startup launch readiness report"
        });

        const { generateLaunchReadinessReport } =
          await import("./launch-readiness-report.js");
        const report = await generateLaunchReadinessReport({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain
        });

        console.log(`Generated launch readiness report: ${report.reportPath}`);
        console.log(`Status: ${report.status}`);
        console.log(`Blockers: ${report.blockers.length}`);

        if (options.print === true) {
          console.log("");
          console.log(report.markdown);
        }
      }
    );

  startupLaunch
    .command("support-triage")
    .description("Record evidence-backed support triage for launch readiness.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--request <text>", "Support request or issue summary")
    .requiredOption("--outcome <text>", "Triage outcome and next action")
    .option("--customer <text>", "Customer or account identifier")
    .option("--severity <level>", "Severity label", "medium")
    .option("--category <name>", "Support category", "uncategorized")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--actor <id>", "RBAC subject for support triage writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        request: string;
        outcome: string;
        customer?: string;
        severity: string;
        category: string;
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
          category: options.category,
          sourceRefs: options.source
        });

        console.log(`Recorded support triage evidence: ${result.evidenceId}`);
        for (const file of result.files) {
          console.log(`Wrote support triage file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
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
    .option("--handoff-due <date>", "Handoff due date")
    .option(
      "--status <status>",
      "Handoff status: open, handoff-in-progress, or handoff-complete",
      "handoff-in-progress"
    )
    .option("--actor <id>", "RBAC subject for bottleneck audit writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        bottleneck: string[];
        owner?: string;
        systemOfRecord?: string;
        handoffDue?: string;
        status: string;
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
            : { systemOfRecord: options.systemOfRecord }),
          ...(options.handoffDue === undefined
            ? {}
            : { handoffDueDate: options.handoffDue }),
          status: options.status
        });

        console.log(`Generated founder bottleneck evidence: ${result.evidenceId}`);
        console.log(`Bottlenecks: ${result.bottlenecks.length}`);
        for (const file of result.files) {
          console.log(`Wrote bottleneck map file: ${file}`);
        }
        logStructuredFiles(result.structuredFiles);
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

        const { generateWorkflowRegistry } = await import("./startup-automation.js");
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
        logStructuredFiles(result.structuredFiles);
      }
    );

  startupScale
    .command("memory-retrieve")
    .description("Retrieve institutional memory for worker context and audit access.")
    .option("--cwd <path>", "Workspace directory")
    .option("--scope <scope>", "Memory scope", "startup/institutional-memory")
    .option("--query <text>", "Search text")
    .option("--limit <number>", "Maximum facts to return", "10")
    .option("--actor <id>", "RBAC subject for memory retrieval", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        scope: string;
        query?: string;
        limit: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "memory.read",
          action: "retrieve startup institutional memory"
        });

        const { retrieveStartupInstitutionalMemory } =
          await import("./startup-automation.js");
        const result = retrieveStartupInstitutionalMemory({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          scope: options.scope,
          ...(options.query === undefined ? {} : { query: options.query }),
          limit: parsePositiveInteger(options.limit, "--limit")
        });

        console.log(`Retrieval audit: ${result.retrievalId}`);
        for (const fact of result.facts) {
          console.log(`${fact.id} ${fact.scope}: ${fact.content}`);
        }
      }
    );

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

        const { generateIntegrationMap } = await import("./startup-automation.js");
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

        const { scheduleScaleReport } = await import("./startup-automation.js");
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
        logStructuredFiles(result.structuredFiles);
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
    .option(
      "--status <status>",
      "Hypothesis status: open, validated, invalidated, or needs-more-evidence",
      "open"
    )
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for hypothesis writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        kind: string;
        statement: string;
        status: string;
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
          status: parseStartupHypothesisStatus(options.status),
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
    .command("customer-interview")
    .description("Record structured customer interview evidence.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--persona <text>", "Customer persona")
    .requiredOption("--problem <text>", "Problem described by the customer")
    .option("--quote <text>", "Direct customer quote")
    .option("--summary <text>", "Interview summary")
    .requiredOption("--signal-strength <text>", "Signal strength")
    .requiredOption("--hypothesis <id>", "Associated hypothesis id")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        persona: string;
        problem: string;
        quote?: string;
        summary?: string;
        signalStrength: string;
        hypothesis: string;
        source: string[];
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "write structured customer interview evidence"
        });

        if (options.quote === undefined && options.summary === undefined) {
          throw new Error("customer-interview requires --quote or --summary");
        }

        const { addStartupEvidence } = await import("./startup-evidence.js");
        const result = await addStartupEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          type: "customer_interview",
          summary: options.summary ?? options.quote ?? "Customer interview evidence",
          sourceRefs: options.source,
          content: JSON.stringify(
            {
              persona: options.persona,
              problem: options.problem,
              ...(options.quote === undefined ? {} : { quote: options.quote }),
              ...(options.summary === undefined ? {} : { summary: options.summary }),
              signalStrength: options.signalStrength
            },
            null,
            2
          ),
          hypothesisId: options.hypothesis,
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Recorded customer interview evidence: ${result.evidence.id}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  startupEvidence
    .command("competitor")
    .description("Record structured competitor evidence.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--competitor <name>", "Competitor or alternative")
    .requiredOption("--finding <text>", "Competitive finding")
    .requiredOption("--signal-strength <text>", "Signal strength")
    .requiredOption("--hypothesis <id>", "Associated hypothesis id")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--goal <id>", "Associated goal id")
    .option("--actor <id>", "RBAC subject for evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        competitor: string;
        finding: string;
        signalStrength: string;
        hypothesis: string;
        source: string[];
        goal?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "write structured competitor evidence"
        });

        const { addStartupEvidence } = await import("./startup-evidence.js");
        const result = await addStartupEvidence({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          type: "competitor",
          summary: `${options.competitor}: ${options.finding}`,
          sourceRefs: options.source,
          content: JSON.stringify(
            {
              competitor: options.competitor,
              finding: options.finding,
              signalStrength: options.signalStrength
            },
            null,
            2
          ),
          hypothesisId: options.hypothesis,
          ...(options.goal === undefined ? {} : { goalId: options.goal })
        });

        console.log(`Recorded competitor evidence: ${result.evidence.id}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  startupEvidence
    .command("add")
    .description("Add customer, competitor, metric, hypothesis, or decision evidence.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption(
      "--type <type>",
      "Evidence type: customer_interview, competitor, metric, metric_snapshot, measurement_framework, agent_context, repo_readiness, security_baseline, migration_plan, rollback_plan, release_plan, hypothesis, problem_hypothesis, user_hypothesis, solution_hypothesis, disconfirming, support_triage, founder_bottleneck, workflow_registry, delegation_policy, institutional_memory, memory_retrieval, ops_schedule, ops_report, integration_map, ops_sop, gtm_artifact, decision, acceptable_debt, false_positive, or observability"
    )
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical external source URI")
    .option("--source-kind <kind>", "Source kind, such as github, posthog, jira, csv, browser_ui, deployment, or manual")
    .option("--captured-at <iso>", "Timestamp when the source was captured")
    .option("--freshness-days <days>", "Maximum acceptable source age in days")
    .option("--source-hash <hash>", "Optional hash of the captured source payload")
    .option("--content <text>", "Optional evidence body")
    .option("--goal <id>", "Associated goal id")
    .option("--hypothesis <id>", "Associated hypothesis id")
    .option("--decision <id>", "Associated decision id")
    .option("--gate <stage>", "Associated gate: idea, mvp, launch, or scale")
    .option("--blocker <text>", "Associated blocker or risk this evidence resolves")
    .option("--owner <id>", "Evidence or remediation owner")
    .option("--remediation-task <text>", "Remediation task tied to this evidence")
    .option("--acceptance-criteria <text>", "Acceptance criteria tied to this evidence")
    .option("--actor <id>", "RBAC subject for evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        type: string;
        summary: string;
        source: string[];
        sourceUri?: string;
        sourceKind?: string;
        capturedAt?: string;
        freshnessDays?: string;
        sourceHash?: string;
        content?: string;
        goal?: string;
        hypothesis?: string;
        decision?: string;
        gate?: string;
        blocker?: string;
        owner?: string;
        remediationTask?: string;
        acceptanceCriteria?: string;
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
          ...evidenceSourceDetails(options),
          ...(options.content === undefined ? {} : { content: options.content }),
          ...(options.goal === undefined ? {} : { goalId: options.goal }),
          ...(options.hypothesis === undefined
            ? {}
            : { hypothesisId: options.hypothesis }),
          ...(options.decision === undefined ? {} : { decisionId: options.decision }),
          ...(options.gate === undefined
            ? {}
            : { gate: parseStartupGateStage(options.gate) }),
          ...(options.blocker === undefined ? {} : { blocker: options.blocker }),
          ...(options.owner === undefined ? {} : { owner: options.owner }),
          ...(options.remediationTask === undefined
            ? {}
            : { remediationTask: options.remediationTask }),
          ...(options.acceptanceCriteria === undefined
            ? {}
            : { acceptanceCriteria: options.acceptanceCriteria })
        });

        console.log(`Recorded startup evidence: ${result.evidence.id}`);
        console.log(`Type: ${result.evidence.type}`);
        console.log(
          `Subject: ${result.evidence.subjectType} ${result.evidence.subjectId}`
        );
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  const startupArtifact = startup
    .command("artifact")
    .description("Query structured startup artifacts.");

  startupArtifact
    .command("list")
    .description("List structured startup artifacts and their evidence references.")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for artifact reads", "local-admin")
    .action(async (options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.read",
        action: "list startup artifacts"
      });

      const { listStartupArtifacts, formatStartupArtifactList } =
        await import("./startup-artifacts.js");
      const result = await listStartupArtifacts({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupArtifactList(result));
    });

  startupArtifact
    .command("show")
    .description("Show a structured startup artifact as JSON.")
    .argument("<ref>", "Artifact id, kind, path, or filename")
    .option("--cwd <path>", "Workspace directory")
    .option("--actor <id>", "RBAC subject for artifact reads", "local-admin")
    .action(async (ref: string, options: { cwd?: string; actor: string }) => {
      await requireRbacPermission({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        actor: options.actor,
        permission: "evidence.read",
        action: "show startup artifact"
      });

      const { showStartupArtifact, formatStartupArtifactShow } =
        await import("./startup-artifacts.js");
      const result = await showStartupArtifact({
        ref,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      });

      console.log(formatStartupArtifactShow(result));
    });

  startup
    .command("remediate")
    .description("Generate or execute worker-ready remediation tasks for startup gate blockers.")
    .option("--cwd <path>", "Workspace directory")
    .option(
      "--stage <stage>",
      "Stage to remediate: idea, mvp, launch, or scale",
      "launch"
    )
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option("--execute", "Create local agent tasks and run the remediation loop")
    .option(
      "--worker <worker>",
      "Worker for --execute: codex_direct, codex_cli, or claude_code",
      "codex_cli"
    )
    .option("--model <model>", "Model override for wrapped/direct worker execution")
    .option("--max-tasks <count>", "Maximum blockers to execute in this run")
    .option("--actor <id>", "RBAC subject for remediation task creation", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        stage: string;
        domain: string;
        execute?: boolean;
        worker: string;
        model?: string;
        maxTasks?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "task.run",
          action: "create startup remediation tasks"
        });

        const {
          executeStartupRemediationPlan,
          formatStartupRemediationExecution,
          formatStartupRemediationPlan,
          generateStartupRemediationPlan
        } = await import("./startup-remediation.js");
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          stage: parseStartupGateStage(options.stage)
        };

        if (options.execute === true) {
          const result = await executeStartupRemediationPlan({
            ...common,
            worker: parseLocalAgentWorker(options.worker),
            ...(options.model === undefined ? {} : { model: options.model }),
            ...(options.maxTasks === undefined
              ? {}
              : { maxTasks: parsePositiveInteger(options.maxTasks, "--max-tasks") })
          });

          console.log(formatStartupRemediationExecution(result));
          return;
        }

        const result = await generateStartupRemediationPlan(common);

        console.log(formatStartupRemediationPlan(result));
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

function logStructuredFiles(files: string[]): void {
  for (const file of files) {
    console.log(`Wrote structured artifact: ${file}`);
  }
}

function evidenceSourceDetails(options: {
  sourceUri?: string;
  sourceKind?: string;
  capturedAt?: string;
  freshnessDays?: string;
  sourceHash?: string;
}): { sources?: StartupEvidenceSourceInput[] } {
  const hasSourceDetail =
    options.sourceUri !== undefined ||
    options.sourceKind !== undefined ||
    options.capturedAt !== undefined ||
    options.freshnessDays !== undefined ||
    options.sourceHash !== undefined;

  if (!hasSourceDetail) {
    return {};
  }

  if (options.sourceUri === undefined) {
    throw new Error("--source-uri is required when source detail options are used");
  }

  return {
    sources: [
      {
        uri: options.sourceUri,
        ...(options.sourceKind === undefined ? {} : { kind: options.sourceKind }),
        ...(options.capturedAt === undefined ? {} : { capturedAt: options.capturedAt }),
        ...(options.freshnessDays === undefined
          ? {}
          : {
              freshnessDays: parsePositiveInteger(
                options.freshnessDays,
                "--freshness-days"
              )
            }),
        ...(options.sourceHash === undefined ? {} : { hash: options.sourceHash })
      }
    ]
  };
}

function parseStartupGateStage(value: string): "idea" | "mvp" | "launch" | "scale" {
  if (value === "idea" || value === "mvp" || value === "launch" || value === "scale") {
    return value;
  }

  throw new Error("--stage must be one of: idea, mvp, launch, scale");
}

function parseStartupAssessStages(value: string): ("mvp" | "launch" | "scale")[] {
  if (value === "all") {
    return ["mvp", "launch", "scale"];
  }

  if (value === "mvp" || value === "launch" || value === "scale") {
    return [value];
  }

  throw new Error("--stage must be one of: all, mvp, launch, scale");
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

function parseStartupHypothesisStatus(
  value: string
): "open" | "validated" | "invalidated" | "needs-more-evidence" {
  if (
    value === "open" ||
    value === "validated" ||
    value === "invalidated" ||
    value === "needs-more-evidence"
  ) {
    return value;
  }

  throw new Error(
    "--status must be one of: open, validated, invalidated, needs-more-evidence"
  );
}

function parseLocalAgentWorker(
  value: string
): "codex_direct" | "codex_cli" | "claude_code" {
  if (value === "codex_direct" || value === "codex_cli" || value === "claude_code") {
    return value;
  }

  throw new Error("--worker must be one of: codex_direct, codex_cli, claude_code");
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
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
