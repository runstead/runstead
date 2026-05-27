import type { Command } from "commander";

import { requireRbacPermission } from "../cli-rbac.js";
import { collectValues } from "../startup-command-parsers.js";

export function registerStartupStructuredEvidenceCommands(
  startupEvidence: Command
): void {
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
    .action(recordCustomerInterviewEvidence);

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
    .action(recordCompetitorEvidence);
}

interface CustomerInterviewEvidenceOptions {
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
}

interface CompetitorEvidenceOptions {
  cwd?: string;
  competitor: string;
  finding: string;
  signalStrength: string;
  hypothesis: string;
  source: string[];
  goal?: string;
  actor: string;
}

async function recordCustomerInterviewEvidence(
  options: CustomerInterviewEvidenceOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "write structured customer interview evidence"
  });

  if (options.quote === undefined && options.summary === undefined) {
    throw new Error("customer-interview requires --quote or --summary");
  }

  const { addStartupEvidence } = await import("../startup-evidence.js");
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

async function recordCompetitorEvidence(
  options: CompetitorEvidenceOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "evidence.write",
    action: "write structured competitor evidence"
  });

  const { addStartupEvidence } = await import("../startup-evidence.js");
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
