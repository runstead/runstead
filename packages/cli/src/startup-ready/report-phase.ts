import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "../runstead-root.js";
import { generateStartupCiSummary } from "../startup-ci-integration.js";
import type { generateStartupCompleteProductCheck } from "../startup-complete-check.js";
import { formatStartupWorkerGovernanceNotice } from "../startup-founder-flow.js";
import type { StartupReadinessRun } from "./types.js";
import {
  evaluateStartupReadinessVerdict,
  startupReadinessDecisionMatrix,
  startupReadinessTargetBoundary
} from "./decision.js";
import { formatStartupReadinessDecisionMarkdown } from "./format.js";
import {
  buildStartupReadyGuidedFlow,
  buildStartupReadyOperatorCommands
} from "./operator-actions.js";
import {
  collectRunEvidence,
  hasPhase,
  startupReadyStageToGateStage,
  unique,
  updatePhase
} from "./shared.js";

export function startupCompleteProductArtifacts(
  complete: Awaited<ReturnType<typeof generateStartupCompleteProductCheck>>
): string[] {
  return unique([
    complete.markdownPath,
    complete.jsonPath,
    complete.surfaces.launchReportMarkdown,
    complete.surfaces.launchReportJson,
    complete.surfaces.ciMarkdown,
    complete.surfaces.ciJson,
    complete.surfaces.dashboardHtml,
    complete.surfaces.dashboardJson,
    complete.surfaces.diagnosticsMarkdown,
    complete.surfaces.diagnosticsJson
  ]);
}

export async function writeStartupReadinessDecisionReport(
  run: StartupReadinessRun,
  now: Date
): Promise<StartupReadinessRun> {
  const root = await resolveRunsteadRoot(run.cwd);
  const reportDir = join(root.root, "reports");
  const markdownPath = join(reportDir, `startup-readiness-run-${run.id}.md`);
  const jsonPath = join(reportDir, `startup-readiness-run-${run.id}.json`);
  const decisions = startupReadinessDecisionMatrix(run);
  const verdict = evaluateStartupReadinessVerdict({
    run,
    evidenceTiers: run.evidenceTiers,
    evidenceTypes: run.evidenceTypes,
    evidenceRequirements: run.evidenceRequirements,
    staleEvidenceRefs: run.staleEvidenceRefs,
    supersededEvidenceRefs: run.supersededEvidenceRefs
  });
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    run: {
      id: run.id,
      cwd: run.cwd,
      stage: run.stage,
      target: run.target,
      worker: run.worker,
      workerGovernance: formatStartupWorkerGovernanceNotice(run.worker),
      ...(run.runtimeBackend === undefined
        ? {}
        : { runtimeBackend: run.runtimeBackend }),
      ...(run.scaffoldProfile === undefined
        ? {}
        : { scaffoldProfile: run.scaffoldProfile }),
      status: run.status,
      verdict: run.verdict,
      verdictBlockers: run.verdictBlockers,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      gitHead: run.gitHead,
      dirtyState: run.dirtyState,
      ...(run.dirtyBreakdown === undefined
        ? {}
        : { dirtyBreakdown: run.dirtyBreakdown }),
      codeFingerprint: run.codeFingerprint
    },
    verdict: {
      requested: {
        target: verdict.target,
        verdict: verdict.verdict,
        canLaunch: verdict.canLaunch,
        blockers: verdict.blockers,
        warnings: verdict.warnings,
        evidenceRefs: verdict.evidenceRefs,
        staleEvidenceRefs: verdict.staleEvidenceRefs,
        supersededEvidenceRefs: verdict.supersededEvidenceRefs
      },
      targetReadiness: verdict.targetReadiness
    },
    targetBoundary: startupReadinessTargetBoundary(run.target),
    guidedFlow: buildStartupReadyGuidedFlow(run),
    operatorCommands: buildStartupReadyOperatorCommands(run),
    decisions,
    evidence: {
      ids: run.evidenceIds,
      tiers: run.evidenceTiers,
      types: run.evidenceTypes,
      phaseEvidence: run.phases.map((phase) => ({
        phase: phase.id,
        status: phase.status,
        ...(phase.execution === undefined ? {} : { execution: phase.execution }),
        evidenceIds: phase.evidenceIds,
        artifacts: phase.artifacts,
        blockers: phase.blockers,
        ...(phase.warnings === undefined ? {} : { warnings: phase.warnings })
      }))
    },
    reports: unique([...run.reportPaths, markdownPath, jsonPath])
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    formatStartupReadinessDecisionMarkdown(payload),
    "utf8"
  );

  run.reportPaths = unique([...run.reportPaths, markdownPath, jsonPath]);
  if (hasPhase(run, "launch_report")) {
    const launchReport = run.phases.find((phase) => phase.id === "launch_report");

    updatePhase(run, "launch_report", {
      artifacts: unique([...(launchReport?.artifacts ?? []), markdownPath, jsonPath])
    });
  }
  collectRunEvidence(run);

  return run;
}

export async function writeStartupReadinessCiOutputs(
  run: StartupReadinessRun,
  now: Date
): Promise<StartupReadinessRun> {
  const ci = await generateStartupCiSummary({
    cwd: run.cwd,
    stage: startupReadyStageToGateStage(run.stage),
    checkName: "Runstead Startup Readiness",
    readiness: {
      verdict: run.verdict,
      blockers: run.verdictBlockers
    },
    now
  });

  run.reportPaths = unique([...run.reportPaths, ci.markdownPath, ci.jsonPath]);
  if (!run.evidenceTiers.includes("ci_verified")) {
    run.evidenceTiers = [...run.evidenceTiers, "ci_verified"];
  }

  const reportPhaseId = hasPhase(run, "launch_report")
    ? "launch_report"
    : hasPhase(run, "complete_check")
      ? "complete_check"
      : undefined;

  if (reportPhaseId !== undefined) {
    const reportPhase = run.phases.find((phase) => phase.id === reportPhaseId);

    updatePhase(run, reportPhaseId, {
      artifacts: unique([
        ...(reportPhase?.artifacts ?? []),
        ci.markdownPath,
        ci.jsonPath
      ])
    });
  }

  collectRunEvidence(run);

  return run;
}
