import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { formatScaleStarterPack } from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence, checkStartupGate } from "./startup-evidence.js";
import type {
  GenerateScaleStarterPackOptions,
  GenerateScaleStarterPackResult
} from "./startup-automation-types.js";
import { recordSupportTriage } from "./startup-scale-founder.js";
import {
  generateOpsSops,
  scheduleScaleReport,
  verifyGtmArtifacts
} from "./startup-scale-ops.js";
import { generateWorkflowRegistry } from "./startup-scale-workflow.js";

export {
  generateFounderBottleneckMap,
  recordSupportTriage
} from "./startup-scale-founder.js";
export {
  captureInstitutionalMemory,
  generateIntegrationMap,
  generateWorkflowRegistry,
  retrieveStartupInstitutionalMemory
} from "./startup-scale-workflow.js";
export {
  generateOpsSops,
  generateScaleOpsReport,
  scheduleScaleReport,
  verifyGtmArtifacts
} from "./startup-scale-ops.js";

export async function generateScaleStarterPack(
  options: GenerateScaleStarterPackOptions = {}
): Promise<GenerateScaleStarterPackResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const owner = options.owner ?? "founder";
  const workflow = await generateWorkflowRegistry({
    cwd,
    workflows: [
      "Weekly evidence-backed scale readiness review",
      "Support triage and escalation",
      "Launch metric review and anomaly follow-up",
      "GTM claim review before external publishing"
    ],
    delegationRules: [
      "Agents may draft scale artifacts; founder approval is required before external publishing.",
      "Support automation may classify requests; high-severity incidents require owner review.",
      "Metric interpretation must cite source class, freshness, and evidence id."
    ],
    approvalBoundaries: [
      "external publishing",
      "billing or pricing changes",
      "high-severity customer support closure"
    ],
    allowedAgents: ["codex_cli", "codex_direct"],
    constrainedTaskTypes: [
      "startup_scale_report",
      "support_triage",
      "gtm_artifact_review"
    ],
    now
  });
  const support = await recordSupportTriage({
    cwd,
    request: "Scale starter support triage template",
    outcome:
      "Route onboarding friction, product defects, billing issues, and security incidents to named owners before scale delegation.",
    customer: "starter-template",
    severity: "medium",
    category: "scale_readiness",
    sourceRefs: workflow.files,
    now
  });
  const schedule = await scheduleScaleReport({
    cwd,
    cadence: "weekly",
    owner,
    nextRunAt: generatedAt.slice(0, 10),
    periodTemplate: "YYYY-WW",
    now
  });
  const sops = await generateOpsSops({
    cwd,
    owner,
    workflow: "scale readiness operations",
    sops: [
      "Generate the startup scale report every week and review every blocker.",
      "Check support categories for repeated onboarding friction before delegation.",
      "Refresh metric snapshots and confirm source class before GTM claims are reused.",
      "Escalate billing, privacy, security, and external publishing changes for approval."
    ],
    now
  });
  const gtm = await verifyGtmArtifacts({
    cwd,
    claims: [
      "Public launch copy is backed by current product evidence.",
      "Scale claims are not published until workflow, support, SOP, and metrics evidence are current."
    ],
    evidenceRefs: [...workflow.evidenceIds, support.evidenceId, sops.evidenceId],
    productState: "scale starter pack generated; scale-ready status is not granted",
    now
  });
  const scaleGate = await checkStartupGate({
    cwd,
    stage: "scale",
    recordEvent: false,
    now
  });
  const files = [
    ...workflow.files,
    ...support.files,
    ...schedule.files,
    ...sops.files,
    ...gtm.files
  ];
  const structuredFiles = [
    ...workflow.structuredFiles,
    ...support.structuredFiles,
    ...schedule.structuredFiles,
    ...sops.structuredFiles,
    ...gtm.structuredFiles
  ];
  const evidenceIds = [
    ...workflow.evidenceIds,
    support.evidenceId,
    schedule.evidenceId,
    sops.evidenceId,
    gtm.evidenceId
  ];
  const nextCommands = [
    "runstead startup scale-check",
    "runstead startup scale report",
    "runstead startup remediate --stage scale --execute --worker codex_cli"
  ];
  const summaryPath = join(state.root, "startup", "scale-starter-pack.md");
  const markdown = formatScaleStarterPack({
    generatedAt,
    owner,
    files,
    evidenceIds,
    blockers: scaleGate.blockers,
    nextCommands
  });

  await mkdir(join(state.root, "startup"), { recursive: true });
  await writeFile(summaryPath, markdown, "utf8");
  const structuredPath = await writeStartupStructuredArtifact({
    kind: "startup_scale_starter_pack",
    generatedAt,
    markdownPath: summaryPath,
    data: {
      owner,
      files: [summaryPath, ...files],
      evidenceIds,
      blockers: scaleGate.blockers,
      scaleReady: false,
      nextCommands
    }
  });
  const starterEvidence = await addStartupEvidence({
    cwd,
    type: "scale_starter_pack",
    summary: "Scale starter pack generated; scale-ready status is not granted",
    sourceRefs: [summaryPath, structuredPath, ...files],
    content: JSON.stringify(
      {
        markdown,
        owner,
        files: [summaryPath, ...files],
        evidenceIds,
        blockers: scaleGate.blockers,
        scaleReady: false,
        nextCommands
      },
      null,
      2
    ),
    now
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [summaryPath, ...files],
    structuredFiles: [structuredPath, ...structuredFiles],
    evidenceIds: [starterEvidence.evidence.id, ...evidenceIds],
    scaleReady: false,
    blockers: scaleGate.blockers,
    nextCommands
  };
}
