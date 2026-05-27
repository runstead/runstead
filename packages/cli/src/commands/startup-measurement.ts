import type { Command } from "commander";

import { registerStartupMeasurementAssessCommand } from "./startup-measurement-assess.js";
import { registerStartupMeasurementGenerateCommand } from "./startup-measurement-generate.js";
import { registerStartupMeasurementSnapshotCommand } from "./startup-measurement-snapshot.js";

export function registerStartupMeasurementCommand(startup: Command): Command {
  const startupMeasurement = startup
    .command("measurement")
    .description("Generate startup measurement framework artifacts.");

  registerStartupMeasurementGenerateCommand(startupMeasurement);
  registerStartupMeasurementSnapshotCommand(startupMeasurement);
  registerStartupMeasurementAssessCommand(startupMeasurement);

  return startupMeasurement;
}
