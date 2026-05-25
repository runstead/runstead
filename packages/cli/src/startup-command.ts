import type { Command } from "commander";

import { registerStartupApiCommand } from "./commands/startup-api.js";
import { registerStartupAssessCommand } from "./commands/startup-assess.js";
import { registerStartupArtifactCommand } from "./commands/startup-artifact.js";
import { registerStartupCiCommand } from "./commands/startup-ci.js";
import { registerStartupContextCommand } from "./commands/startup-context.js";
import { registerStartupFounderCommands } from "./commands/startup-founder.js";
import { registerStartupGateCommand } from "./commands/startup-gate.js";
import { registerStartupHypothesisCommand } from "./commands/startup-hypothesis.js";
import { registerStartupLaunchCommand } from "./commands/startup-launch.js";
import { registerStartupMeasurementCommand } from "./commands/startup-measurement.js";
import { registerStartupReadyCommand } from "./commands/startup-ready.js";
import { registerStartupScaleCommand } from "./commands/startup-scale.js";
import { registerStartupSourceCommand } from "./commands/startup-source.js";
import { registerStartupTeamCommand } from "./commands/startup-team.js";
import { checkPermission } from "./rbac.js";
import { evidenceSourceDetails } from "./startup-evidence-source-options.js";
import {
  collectValues,
  parseLocalAgentWorker,
  parsePositiveInteger,
  parseStartupGateStage,
  parseStartupInitStage
} from "./startup-command-parsers.js";
import {
  formatWorkerProcessProgress,
  type WorkerProcessProgress
} from "./wrapped-worker.js";

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
    .command("status")
    .description(
      "Show the founder startup stage, gate blockers, evidence freshness, and next action."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .action(async (options: { cwd?: string; domain: string }) => {
      const { formatStartupStatus, getStartupStatus } =
        await import("./startup-status.js");
      const result = await getStartupStatus({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        domain: options.domain
      });

      console.log(formatStartupStatus(result));
    });

  registerStartupApiCommand(startup);

  registerStartupAssessCommand(startup);

  registerStartupReadyCommand(startup);

  registerStartupFounderCommands(startup);

  registerStartupCiCommand(startup);

  registerStartupContextCommand(startup);

  registerStartupMeasurementCommand(startup);

  registerStartupSourceCommand(startup);

  registerStartupLaunchCommand(startup);

  registerStartupScaleCommand(startup);

  registerStartupTeamCommand(startup);

  registerStartupHypothesisCommand(startup);

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
      "Evidence type: customer_interview, competitor, metric, metric_snapshot, measurement_framework, agent_context, repo_readiness, security_baseline, migration_plan, rollback_plan, release_plan, launch_git_path, ui_validation, hypothesis, problem_hypothesis, user_hypothesis, solution_hypothesis, disconfirming, support_triage, founder_bottleneck, workflow_registry, delegation_policy, institutional_memory, memory_retrieval, ops_schedule, ops_report, integration_map, ops_sop, gtm_artifact, scale_starter_pack, decision, acceptable_debt, false_positive, observability, remediation_failure, team_collaboration, manual_change, or complete_product_check"
    )
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--source <ref>", "Evidence source reference", collectValues, [])
    .option("--source-uri <uri>", "Canonical external source URI")
    .option(
      "--source-kind <kind>",
      "Source kind, such as github, posthog, jira, csv, browser_ui, deployment, or manual"
    )
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

  startupEvidence
    .command("manual-change")
    .description("Record an operator-applied code or configuration change.")
    .option("--cwd <path>", "Workspace directory")
    .requiredOption("--operator <id>", "Human operator who made the change")
    .requiredOption("--reason <text>", "Why the manual change was needed")
    .requiredOption("--diff-summary <text>", "Concise diff summary")
    .option("--file <path>", "File touched by the manual change", collectValues, [])
    .option(
      "--command <cmd>",
      "Verifier or command rerun after the change",
      collectValues,
      []
    )
    .option(
      "--evidence <id>",
      "Evidence id produced after the change",
      collectValues,
      []
    )
    .option(
      "--source <ref>",
      "Source reference for the manual change",
      collectValues,
      []
    )
    .option("--goal <id>", "Associated goal id")
    .option("--gate <stage>", "Associated gate: idea, mvp, launch, or scale")
    .option("--blocker <text>", "Associated blocker or risk this change resolves")
    .option("--actor <id>", "RBAC subject for evidence writes", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        operator: string;
        reason: string;
        diffSummary: string;
        file: string[];
        command: string[];
        evidence: string[];
        source: string[];
        goal?: string;
        gate?: string;
        blocker?: string;
        actor: string;
      }) => {
        await requireRbacPermission({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor,
          permission: "evidence.write",
          action: "record manual startup change evidence"
        });

        const { recordStartupManualChange } = await import("./startup-evidence.js");
        const result = await recordStartupManualChange({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          operator: options.operator,
          reason: options.reason,
          diffSummary: options.diffSummary,
          filesTouched: options.file,
          commandsRerun: options.command,
          evidenceRefs: options.evidence,
          sourceRefs: options.source,
          ...(options.goal === undefined ? {} : { goalId: options.goal }),
          ...(options.gate === undefined
            ? {}
            : { gate: parseStartupGateStage(options.gate) }),
          ...(options.blocker === undefined ? {} : { blocker: options.blocker })
        });

        console.log(`Recorded manual change evidence: ${result.evidence.id}`);
        console.log(`Type: ${result.evidence.type}`);
        console.log(`Artifact: ${result.artifactPath}`);
      }
    );

  registerStartupArtifactCommand(startup);

  startup
    .command("complete-check")
    .description(
      "Run the minimal complete product audit across launch report, CI gate, dashboard, diagnostics, remediation, evidence, and events."
    )
    .option("--cwd <path>", "Workspace directory")
    .option("--domain <id>", "Domain id to evaluate", "ai-native-startup")
    .option(
      "--target <target>",
      "Launch target: local, staging, or production",
      "local"
    )
    .option("--print", "Print the generated markdown")
    .option("--actor <id>", "RBAC subject for complete product audit", "local-admin")
    .action(
      async (options: {
        cwd?: string;
        domain: string;
        target: string;
        print?: boolean;
        actor: string;
      }) => {
        const common = {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          actor: options.actor
        };

        await requireRbacPermission({
          ...common,
          permission: "evidence.write",
          action: "write startup complete product audit evidence"
        });
        await requireRbacPermission({
          ...common,
          permission: "audit.read",
          action: "read startup complete product audit inputs"
        });
        await requireRbacPermission({
          ...common,
          permission: "dashboard.manage",
          action: "build startup complete product dashboard surface"
        });
        await requireRbacPermission({
          ...common,
          permission: "task.run",
          action: "plan startup complete product remediation"
        });

        const {
          formatStartupCompleteProductCheck,
          generateStartupCompleteProductCheck
        } = await import("./startup-complete-check.js");
        const { parseStartupReadyTarget } = await import("./startup-ready.js");
        const result = await generateStartupCompleteProductCheck({
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          domain: options.domain,
          target: parseStartupReadyTarget(options.target)
        });

        console.log(`Generated startup complete product check: ${result.markdownPath}`);
        console.log(`JSON: ${result.jsonPath}`);
        console.log(`Status: ${result.status}`);
        console.log(`Score: ${Math.round(result.score * 100)}%`);
        console.log(`Evidence: ${result.evidenceId}`);
        console.log(`Event: ${result.event.eventId}`);

        if (options.print === true) {
          console.log("");
          console.log(formatStartupCompleteProductCheck(result));
        }

        if (result.status !== "complete") {
          process.exitCode = 1;
        }
      }
    );

  startup
    .command("remediate")
    .description(
      "Generate or execute worker-ready remediation tasks for startup gate blockers."
    )
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
              : { maxTasks: parsePositiveInteger(options.maxTasks, "--max-tasks") }),
            onWorkerProgress: logWrappedWorkerProgress
          });

          console.log(formatStartupRemediationExecution(result));
          return;
        }

        const result = await generateStartupRemediationPlan(common);

        console.log(formatStartupRemediationPlan(result));
      }
    );

  registerStartupGateCommand(startup);
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

function logWrappedWorkerProgress(progress: WorkerProcessProgress): void {
  console.error(formatWorkerProcessProgress(progress));
}
