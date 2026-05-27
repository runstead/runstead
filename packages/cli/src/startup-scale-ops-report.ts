import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { formatScaleOpsReport } from "./startup-automation-format.js";
import type {
  GenerateScaleOpsReportOptions,
  GenerateScaleOpsReportResult
} from "./startup-automation-types.js";
import {
  listStartupArtifacts,
  writeStartupStructuredArtifact
} from "./startup-artifacts.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import {
  readStartupEvidenceSummaries,
  supportCategoryCountsFromArtifacts,
  type StartupEvidenceSummaryRow
} from "./startup-evidence-summary.js";
import { requireRunsteadStateDb } from "./runstead-root.js";

export async function generateScaleOpsReport(
  options: GenerateScaleOpsReportOptions = {}
): Promise<GenerateScaleOpsReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const period = options.period ?? generatedAt.slice(0, 10);
  const database = openRunsteadDatabase(state.stateDb);
  let evidence: StartupEvidenceSummaryRow[];

  try {
    evidence = readStartupEvidenceSummaries(database);
  } finally {
    database.close();
  }
  const startupArtifacts = (await listStartupArtifacts({ cwd })).artifacts;
  const supportCategoryCounts = supportCategoryCountsFromArtifacts(startupArtifacts);
  const scaleGate = await checkStartupGate({
    cwd,
    stage: "scale",
    recordEvent: false,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  const markdown = formatScaleOpsReport({
    generatedAt,
    period,
    evidence,
    supportCategoryCounts,
    blockers: scaleGate.blockers
  });

  await mkdir(join(state.root, "reports"), { recursive: true });

  const runtimePath = join(state.root, "reports", `startup-ops-${period}.md`);

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_report",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        period,
        evidence,
        supportCategoryCounts,
        blockers: scaleGate.blockers
      }
    })
  ];

  const reportEvidence = await addStartupEvidence({
    cwd,
    type: "ops_report",
    summary: `Startup scale ops report generated for ${period}`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: reportEvidence.evidence.id,
    period
  };
}
