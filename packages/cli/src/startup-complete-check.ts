import { join, resolve } from "node:path";

import { createRunsteadId } from "@runstead/core";

import { buildDashboard } from "./dashboard.js";
import { collectRepoInspection } from "./inspection-evidence.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import { generateOpsDiagnosticsBundle } from "./ops-diagnostics.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { generateStartupCiSummary } from "./startup-ci-integration.js";
import {
  startupCompleteProductBaseCriteria,
  startupCompleteProductBlockers
} from "./startup-complete-check-criteria.js";
import {
  existingStartupCompleteProductPathState,
  readStartupCompleteProductEventCount,
  readStartupCompleteProductEvidenceRows
} from "./startup-complete-check-data.js";
import {
  completeProductStatus,
  formatStartupCompleteProductCheck
} from "./startup-complete-check-output.js";
import {
  startupCompleteProductEvidenceContent,
  startupCompleteProductEvidenceSummary
} from "./startup-complete-check-evidence.js";
import {
  appendStartupCompleteProductCheckEvent,
  writeStartupCompleteProductCheckArtifacts
} from "./startup-complete-check-persistence.js";
import { buildStartupCompleteProductCheckResult } from "./startup-complete-check-result.js";
import {
  startupCompleteProductEvidenceSourceRefs,
  startupCompleteProductExistingArtifactPaths,
  startupCompleteProductSurfaces
} from "./startup-complete-check-surfaces.js";
import type {
  GenerateStartupCompleteProductCheckOptions,
  StartupCompleteProductCheckResult
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
  const pathState = await existingStartupCompleteProductPathState(
    startupCompleteProductExistingArtifactPaths({
      launchReport,
      ci,
      dashboard,
      diagnostics
    })
  );
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
    summary: startupCompleteProductEvidenceSummary(baseStatus),
    sourceRefs: startupCompleteProductEvidenceSourceRefs({
      markdownPath,
      jsonPath,
      launchReport,
      ci,
      dashboard,
      diagnostics
    }),
    content: startupCompleteProductEvidenceContent({
      domain,
      status: baseStatus,
      criteria: baseCriteria
    }),
    now
  });
  const surfaces = startupCompleteProductSurfaces({
    launchReport,
    ci,
    dashboard,
    diagnostics,
    markdownPath,
    jsonPath,
    evidenceId: evidence.evidence.id,
    eventId
  });
  const result = buildStartupCompleteProductCheckResult({
    root: state.root,
    stateDb: state.stateDb,
    domain,
    generatedAt,
    markdownPath,
    jsonPath,
    eventId,
    evidenceId: evidence.evidence.id,
    baseCriteria,
    blockers,
    surfaces,
    launchReport,
    ci,
    remediation,
    diagnostics
  });
  const markdown = formatStartupCompleteProductCheck(result);

  await writeStartupCompleteProductCheckArtifacts({
    result,
    markdown,
    launchReport,
    ci,
    remediation,
    diagnostics
  });
  appendStartupCompleteProductCheckEvent(result);

  return {
    ...result,
    markdown
  };
}
