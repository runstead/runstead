import { writeFile } from "node:fs/promises";

import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { LaunchReadinessReportResult } from "./launch-readiness-report.js";
import type { OpsDiagnosticsBundleResult } from "./ops-diagnostics.js";
import type { GenerateStartupCiSummaryResult } from "./startup-ci-integration.js";
import { startupCompleteProductJson } from "./startup-complete-check-output.js";
import type { StartupCompleteProductCheckResult } from "./startup-complete-check-types.js";
import type { GenerateStartupRemediationPlanResult } from "./startup-remediation.js";

export async function writeStartupCompleteProductCheckArtifacts(input: {
  result: StartupCompleteProductCheckResult;
  markdown: string;
  launchReport: LaunchReadinessReportResult;
  ci: GenerateStartupCiSummaryResult;
  remediation: GenerateStartupRemediationPlanResult;
  diagnostics: OpsDiagnosticsBundleResult;
}): Promise<void> {
  await writeFile(input.result.markdownPath, input.markdown, "utf8");
  await writeFile(
    input.result.jsonPath,
    `${JSON.stringify(
      startupCompleteProductJson({
        result: input.result,
        launchReport: input.launchReport,
        ci: input.ci,
        remediation: input.remediation,
        diagnostics: input.diagnostics
      }),
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function appendStartupCompleteProductCheckEvent(
  result: StartupCompleteProductCheckResult
): void {
  const database = openRunsteadDatabase(result.stateDb);

  try {
    appendEventAndProject(database, { event: result.event });
  } finally {
    database.close();
  }
}
