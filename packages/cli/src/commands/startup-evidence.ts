import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues, parseStartupGateStage } from "../startup-command-parsers.js";
import { evidenceSourceDetails } from "../startup-evidence-source-options.js";
import { registerStartupStructuredEvidenceCommands } from "./startup-evidence-structured.js";

export function registerStartupEvidenceCommand(startup: Command): Command {
  const startupEvidence = startup
    .command("evidence")
    .description("Manage founder evidence ledger records.");

  registerStartupStructuredEvidenceCommands(startupEvidence);

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

        const { addStartupEvidence } = await import("../startup-evidence.js");
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

        const { recordStartupManualChange } = await import("../startup-evidence.js");
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

  return startupEvidence;
}
