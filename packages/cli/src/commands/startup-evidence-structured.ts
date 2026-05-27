import type { Command } from "commander";

import { collectValues } from "../startup-command-parsers.js";
import {
  recordCompetitorEvidence,
  recordCustomerInterviewEvidence
} from "./startup-evidence-structured-actions.js";

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
