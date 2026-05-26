import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { collectRepoInspection } from "./inspection-evidence.js";
import {
  readLaunchReadinessData,
  type LaunchReadinessReportData
} from "./launch-readiness-data.js";
import { launchReadinessAuditExport } from "./launch-readiness-audit-export.js";
import {
  launchReadinessTargetStatus,
  releaseBlockers
} from "./launch-readiness-decision.js";
import {
  launchReadinessReportEventPayload,
  readPreviousLaunchReadinessEvent
} from "./launch-readiness-events.js";
import { formatLaunchReadinessReport } from "./launch-readiness-report-format.js";
import { changedLaunchReadinessProtectedPaths } from "./launch-readiness-git.js";
import {
  launchReadinessTrustSummary,
  type LaunchReadinessStatus
} from "./launch-readiness-trust.js";
import type {
  GenerateLaunchReadinessReportOptions,
  LaunchReadinessReportResult
} from "./launch-readiness-types.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { listStartupArtifacts } from "./startup-artifacts.js";
import { checkStartupGate } from "./startup-evidence.js";
import { collectCommandVerifierCodeState } from "./verifier-evidence.js";

export type {
  GenerateLaunchReadinessReportOptions,
  LaunchReadinessReportResult,
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";
export type { LaunchReadinessTrustSummary } from "./launch-readiness-trust.js";

const STARTUP_DOMAIN = "ai-native-startup";

export async function generateLaunchReadinessReport(
  options: GenerateLaunchReadinessReportOptions = {}
): Promise<LaunchReadinessReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const domain = options.domain ?? STARTUP_DOMAIN;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const resolvedState = await requireRunsteadStateDb(cwd);
  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const data: LaunchReadinessReportData = {
      generatedAt,
      repo: await collectRepoInspection(cwd, generatedAt),
      protectedPathChanges: await changedLaunchReadinessProtectedPaths(cwd),
      gate: await launchGateEvaluation({
        cwd,
        domain,
        ...(options.now === undefined ? {} : { now: options.now })
      }),
      structuredArtifacts: (await listStartupArtifacts({ cwd })).artifacts,
      currentCodeState: await collectCommandVerifierCodeState(cwd),
      ...readLaunchReadinessData(database, domain)
    };
    const target = options.target ?? "production";
    const blockers = releaseBlockers(data, target);
    const status: LaunchReadinessStatus =
      blockers.length === 0 ? "launch_ready" : "blocked";
    const targetStatus = launchReadinessTargetStatus(target, status);
    const aggregateId = `launch_readiness_${domain.replaceAll("-", "_")}`;
    const previousReport = readPreviousLaunchReadinessEvent(database, aggregateId);
    const trustSummary = launchReadinessTrustSummary({
      status,
      blockers,
      data,
      ...(previousReport === undefined ? {} : { previousReport })
    });
    const markdown = formatLaunchReadinessReport({
      generatedAt,
      domain,
      target,
      status,
      targetStatus,
      blockers,
      trustSummary,
      data
    });
    const reportPath = join(
      resolvedState.root,
      "reports",
      `launch-readiness-${domain}.md`
    );
    const jsonPath = join(
      resolvedState.root,
      "reports",
      `launch-readiness-${domain}.json`
    );
    const auditExport = launchReadinessAuditExport({
      generatedAt,
      domain,
      target,
      status,
      targetStatus,
      blockers,
      trustSummary,
      data
    });
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "report.generated",
      aggregateType: "report",
      aggregateId,
      payload: launchReadinessReportEventPayload({
        domain,
        status,
        target,
        targetStatus,
        blockers,
        reportPath,
        jsonPath,
        markdown,
        trustSummary,
        data
      }),
      createdAt: generatedAt
    };

    await mkdir(join(resolvedState.root, "reports"), { recursive: true });
    await writeFile(reportPath, markdown, "utf8");
    await writeFile(jsonPath, `${JSON.stringify(auditExport, null, 2)}\n`, "utf8");
    appendEventAndProject(database, { event });

    return {
      root: resolvedState.root,
      stateDb,
      domain,
      reportPath,
      jsonPath,
      markdown,
      event,
      status,
      targetStatus,
      blockers,
      trustSummary
    };
  } finally {
    database.close();
  }
}

async function launchGateEvaluation(input: {
  cwd: string;
  domain: string;
  now?: Date;
}): Promise<{ blockers: string[]; warnings: string[] }> {
  const result = await checkStartupGate({
    cwd: input.cwd,
    domain: input.domain,
    stage: "launch",
    ...(input.now === undefined ? {} : { now: input.now }),
    recordEvent: false
  });

  return {
    blockers: result.blockers,
    warnings: result.warnings
  };
}
