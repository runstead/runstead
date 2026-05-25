import type { Command } from "commander";

import { registerStartupApiCommand } from "./commands/startup-api.js";
import { registerStartupAssessCommand } from "./commands/startup-assess.js";
import { registerStartupArtifactCommand } from "./commands/startup-artifact.js";
import { registerStartupCiCommand } from "./commands/startup-ci.js";
import { registerStartupCompleteCheckCommand } from "./commands/startup-complete-check.js";
import { registerStartupContextCommand } from "./commands/startup-context.js";
import { registerStartupCoreCommands } from "./commands/startup-core.js";
import { registerStartupEvidenceCommand } from "./commands/startup-evidence.js";
import { registerStartupFounderCommands } from "./commands/startup-founder.js";
import { registerStartupGateCommand } from "./commands/startup-gate.js";
import { registerStartupHypothesisCommand } from "./commands/startup-hypothesis.js";
import { registerStartupLaunchCommand } from "./commands/startup-launch.js";
import { registerStartupMeasurementCommand } from "./commands/startup-measurement.js";
import { registerStartupReadyCommand } from "./commands/startup-ready.js";
import { registerStartupRemediateCommand } from "./commands/startup-remediate.js";
import { registerStartupScaleCommand } from "./commands/startup-scale.js";
import { registerStartupSourceCommand } from "./commands/startup-source.js";
import { registerStartupTeamCommand } from "./commands/startup-team.js";

export function registerStartupCommands(program: Command): void {
  const startup = program
    .command("startup")
    .description("Manage AI-native startup evidence and stage gates.");

  registerStartupCoreCommands(startup);

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

  registerStartupEvidenceCommand(startup);

  registerStartupArtifactCommand(startup);

  registerStartupCompleteCheckCommand(startup);

  registerStartupRemediateCommand(startup);

  registerStartupGateCommand(startup);
}
