import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues, parseStartupGateStage } from "../startup-command-parsers.js";

export function registerStartupEvidenceManualChangeCommand(
  startupEvidence: Command
): void {
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
    .action(recordStartupManualChangeEvidence);
}

interface StartupEvidenceManualChangeOptions {
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
}

async function recordStartupManualChangeEvidence(
  options: StartupEvidenceManualChangeOptions
): Promise<void> {
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
