import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  formatGtmVerification,
  formatOpsSops,
  formatScaleOpsReport,
  formatScaleReportSchedule,
  formatScaleStarterPack
} from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
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
import type {
  GenerateOpsSopsOptions,
  GenerateOpsSopsResult,
  GenerateScaleOpsReportOptions,
  GenerateScaleOpsReportResult,
  GenerateScaleStarterPackOptions,
  GenerateScaleStarterPackResult,
  ScheduleScaleReportOptions,
  ScheduleScaleReportResult,
  VerifyGtmArtifactsOptions,
  VerifyGtmArtifactsResult
} from "./startup-automation-types.js";
import { recordSupportTriage } from "./startup-scale-founder.js";
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

export async function scheduleScaleReport(
  options: ScheduleScaleReportOptions = {}
): Promise<ScheduleScaleReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const cadence = options.cadence ?? "weekly";
  const owner = options.owner ?? "unassigned";
  const periodTemplate = options.periodTemplate ?? "YYYY-WW";
  const nextRunAt = options.nextRunAt ?? generatedAt.slice(0, 10);
  const nextCommand = `runstead startup scale report --period ${periodTemplate}`;
  const markdown = formatScaleReportSchedule({
    generatedAt,
    cadence,
    owner,
    nextRunAt,
    periodTemplate,
    nextCommand
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "scale-report-schedule.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_schedule",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        cadence,
        owner,
        nextRunAt,
        periodTemplate,
        nextCommand
      }
    })
  ];
  const evidence = await addStartupEvidence({
    cwd,
    type: "ops_schedule",
    summary: `Scale report schedule recorded (${cadence})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        cadence,
        owner,
        nextRunAt,
        periodTemplate,
        nextCommand
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    nextCommand
  };
}

export async function generateOpsSops(
  options: GenerateOpsSopsOptions = {}
): Promise<GenerateOpsSopsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const sops =
    options.sops === undefined || options.sops.length === 0
      ? ["No SOP input recorded; define recurring operation steps before handoff."]
      : options.sops;
  const markdown = formatOpsSops({
    generatedAt,
    sops,
    owner: options.owner ?? "unassigned",
    workflow: options.workflow ?? "unassigned"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "ops-sops.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_ops_sop",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        sops,
        owner: options.owner ?? "unassigned",
        workflow: options.workflow ?? "unassigned"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "ops_sop",
    summary: `Ops SOPs generated (${sops.length} SOP${sops.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    sops
  };
}

export async function verifyGtmArtifacts(
  options: VerifyGtmArtifactsOptions = {}
): Promise<VerifyGtmArtifactsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const claims =
    options.claims === undefined || options.claims.length === 0
      ? ["No GTM claim input recorded; verify launch promises before publishing."]
      : options.claims;
  const markdown = formatGtmVerification({
    generatedAt,
    claims,
    evidenceRefs: options.evidenceRefs ?? [],
    productState: options.productState ?? "unrecorded"
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "gtm-artifacts.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_gtm_artifact",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "gtm_artifact",
    summary: `GTM artifacts verified (${claims.length} claim${claims.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.evidenceRefs ?? [])],
    content: JSON.stringify(
      {
        markdown,
        claims,
        evidenceRefs: options.evidenceRefs ?? [],
        productState: options.productState ?? "unrecorded"
      },
      null,
      2
    ),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id,
    claims
  };
}
