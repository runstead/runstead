import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { buildDashboard } from "./dashboard.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { generateOpsDiagnosticsBundle } from "./ops-diagnostics.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { generateStartupCiSummary } from "./startup-ci-integration.js";
import {
  startupCompleteProductArtifactCriterion,
  startupCompleteProductBaseCriteria,
  startupCompleteProductBlockers
} from "./startup-complete-check-criteria.js";
import {
  existingStartupCompleteProductPathState,
  readStartupCompleteProductEventCount,
  readStartupCompleteProductEvidenceRows
} from "./startup-complete-check-data.js";
import {
  completeProductScore,
  completeProductStatus,
  formatStartupCompleteProductCheck,
  startupCompleteProductEvent,
  startupCompleteProductJson
} from "./startup-complete-check-output.js";
import type {
  GenerateStartupCompleteProductCheckOptions,
  StartupCompleteProductCheckResult,
  StartupCompleteProductSurfaces
} from "./startup-complete-check-types.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import { generateStartupRemediationPlan } from "./startup-remediation.js";
import { getStartupStatus } from "./startup-status.js";

export { formatStartupCompleteProductCheck } from "./startup-complete-check-output.js";
export type {
  GenerateStartupCompleteProductCheckOptions,
  StartupCompleteProductBlockerAudit,
  StartupCompleteProductCheckResult,
  StartupCompleteProductCriterion,
  StartupCompleteProductCriterionStatus,
  StartupCompleteProductStatus,
  StartupCompleteProductSurfaces
} from "./startup-complete-check-types.js";

const STARTUP_DOMAIN = "ai-native-startup";

export async function generateStartupCompleteProductCheck(
  options: GenerateStartupCompleteProductCheckOptions = {}
): Promise<StartupCompleteProductCheckResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const target = options.target ?? "production";
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const state = await requireRunsteadStateDb(cwd);
  const markdownPath = join(state.root, "reports", "startup-complete-product-check.md");
  const jsonPath = join(state.root, "reports", "startup-complete-product-check.json");
  const repo = await collectRepoInspection(cwd, generatedAt);
  const status = await getStartupStatus({ cwd, domain, now });
  const remediation = await generateStartupRemediationPlan({ cwd, domain, now });
  const launchReport = await generateLaunchReadinessReport({
    cwd,
    domain,
    target,
    now
  });
  const ci = await generateStartupCiSummary({
    cwd,
    domain,
    stage: "launch",
    readiness: options.readiness ?? {
      target,
      verdict: launchReport.targetStatus,
      blockers: launchReport.blockers
    },
    now
  });
  const dashboard = await buildDashboard({ cwd, now });
  const diagnostics = await generateOpsDiagnosticsBundle({
    cwd,
    includeStateBackup: true,
    now
  });
  const gate = await checkStartupGate({
    cwd,
    domain,
    stage: "launch",
    now,
    recordEvent: false
  });
  const evidenceRows = readStartupCompleteProductEvidenceRows(state.stateDb);
  const eventCount = readStartupCompleteProductEventCount(state.stateDb);
  const pathState = await existingStartupCompleteProductPathState([
    launchReport.reportPath,
    launchReport.jsonPath,
    ci.markdownPath,
    ci.jsonPath,
    dashboard.htmlPath,
    dashboard.dataPath,
    diagnostics.markdownPath,
    diagnostics.jsonPath,
    ...(diagnostics.stateBackupPath === undefined ? [] : [diagnostics.stateBackupPath])
  ]);
  const blockers = startupCompleteProductBlockers({
    gate,
    launchReport,
    evidenceRows
  });
  const baseCriteria = startupCompleteProductBaseCriteria({
    repo,
    status,
    launchReport,
    remediation,
    ci,
    dashboard,
    diagnostics,
    evidenceRows,
    blockers,
    eventCount,
    pathState,
    target
  });
  const baseStatus = completeProductStatus(baseCriteria);
  const eventId = createRunsteadId("evt");
  const evidence = await addStartupEvidence({
    cwd,
    type: "complete_product_check",
    summary: `Startup complete product check: ${baseStatus}`,
    sourceRefs: [
      markdownPath,
      jsonPath,
      launchReport.reportPath,
      launchReport.jsonPath,
      ci.markdownPath,
      ci.jsonPath,
      dashboard.htmlPath,
      dashboard.dataPath,
      diagnostics.markdownPath,
      diagnostics.jsonPath
    ],
    content: JSON.stringify(
      {
        domain,
        status: baseStatus,
        criteria: baseCriteria.map((criterion) => ({
          id: criterion.id,
          status: criterion.status
        }))
      },
      null,
      2
    ),
    now
  });
  const surfaces: StartupCompleteProductSurfaces = {
    launchReportMarkdown: launchReport.reportPath,
    launchReportJson: launchReport.jsonPath,
    ciMarkdown: ci.markdownPath,
    ciJson: ci.jsonPath,
    dashboardHtml: dashboard.htmlPath,
    dashboardJson: dashboard.dataPath,
    diagnosticsMarkdown: diagnostics.markdownPath,
    diagnosticsJson: diagnostics.jsonPath,
    completeCheckMarkdown: markdownPath,
    completeCheckJson: jsonPath,
    evidenceId: evidence.evidence.id,
    eventId
  };
  const criteria = [...baseCriteria, startupCompleteProductArtifactCriterion(surfaces)];
  const finalStatus = completeProductStatus(criteria);
  const score = completeProductScore(criteria);
  const event = startupCompleteProductEvent({
    eventId,
    domain,
    generatedAt,
    status: finalStatus,
    score,
    markdownPath,
    jsonPath,
    evidenceId: evidence.evidence.id,
    criteria,
    blockers,
    launchReport,
    ci,
    remediation,
    diagnostics
  });
  const result: StartupCompleteProductCheckResult = {
    root: state.root,
    stateDb: state.stateDb,
    domain,
    generatedAt,
    status: finalStatus,
    score,
    markdownPath,
    jsonPath,
    markdown: "",
    event,
    evidenceId: evidence.evidence.id,
    criteria,
    blockers,
    surfaces
  };
  const markdown = formatStartupCompleteProductCheck(result);

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    `${JSON.stringify(startupCompleteProductJson({ result, launchReport, ci, remediation, diagnostics }), null, 2)}\n`,
    "utf8"
  );

  const database = openRunsteadDatabase(state.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return {
    ...result,
    markdown
  };
}
