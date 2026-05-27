import type { StartupUiValidationExecutionEvidence } from "./startup-ui-validation-types.js";

export interface StartupReadyUiSmokeRunResult {
  status: "passed" | "blocked";
  configPath: string;
  configStatus: "generated" | "loaded" | "blocked";
  configWarnings: string[];
  configRepairHints: string[];
  checks: StartupReadyUiSmokeCheckResult[];
  evidenceIds: string[];
  artifacts: string[];
  blockers: string[];
}

export interface StartupReadyUiSmokeCheckResult {
  name: string;
  status: "passed" | "failed";
  evidenceId?: string;
  artifact?: string;
  failureCategory?: string;
  failureSummary?: string;
  repairHint?: string;
  failedAction?: NonNullable<
    StartupUiValidationExecutionEvidence["flowActions"]
  >[number];
  blockers: string[];
}
