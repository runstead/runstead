import type { Command } from "commander";

import { registerStartupEvidenceAddCommand } from "./startup-evidence-add.js";
import { registerStartupEvidenceManualChangeCommand } from "./startup-evidence-manual-change.js";
import { registerStartupStructuredEvidenceCommands } from "./startup-evidence-structured.js";

export function registerStartupEvidenceCommand(startup: Command): Command {
  const startupEvidence = startup
    .command("evidence")
    .description("Manage founder evidence ledger records.");

  registerStartupStructuredEvidenceCommands(startupEvidence);
  registerStartupEvidenceAddCommand(startupEvidence);
  registerStartupEvidenceManualChangeCommand(startupEvidence);

  return startupEvidence;
}
