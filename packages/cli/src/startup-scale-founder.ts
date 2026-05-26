import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  formatFounderBottleneckMap,
  formatSupportTriage,
  safeTimestamp
} from "./startup-automation-format.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { writeStartupStructuredArtifact } from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import type {
  GenerateFounderBottleneckMapOptions,
  GenerateFounderBottleneckMapResult,
  RecordSupportTriageOptions,
  RecordSupportTriageResult
} from "./startup-automation-types.js";

export async function recordSupportTriage(
  options: RecordSupportTriageOptions
): Promise<RecordSupportTriageResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const markdown = formatSupportTriage({
    generatedAt,
    request: options.request,
    outcome: options.outcome,
    ...(options.customer === undefined ? {} : { customer: options.customer }),
    severity: options.severity ?? "medium",
    category: options.category ?? "uncategorized",
    sourceRefs: options.sourceRefs ?? []
  });

  await mkdir(join(state.root, "startup", "support-triage"), { recursive: true });

  const runtimePath = join(
    state.root,
    "startup",
    "support-triage",
    `${safeTimestamp(generatedAt)}.md`
  );

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_support_triage",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        request: options.request,
        outcome: options.outcome,
        customer: options.customer ?? null,
        severity: options.severity ?? "medium",
        category: options.category ?? "uncategorized",
        sourceRefs: options.sourceRefs ?? []
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "support_triage",
    summary: `Support triage recorded (${options.category ?? "uncategorized"}): ${options.outcome}`,
    sourceRefs: [runtimePath, ...structuredFiles, ...(options.sourceRefs ?? [])],
    content: markdown,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id
  };
}

export async function generateFounderBottleneckMap(
  options: GenerateFounderBottleneckMapOptions = {}
): Promise<GenerateFounderBottleneckMapResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const bottlenecks =
    options.bottlenecks === undefined || options.bottlenecks.length === 0
      ? ["No founder-only bottleneck input recorded; complete the audit before scale."]
      : options.bottlenecks;
  const markdown = formatFounderBottleneckMap({
    generatedAt,
    bottlenecks,
    owner: options.owner ?? "unassigned",
    systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
    status: options.status ?? "handoff-in-progress",
    ...(options.handoffDueDate === undefined
      ? {}
      : { handoffDueDate: options.handoffDueDate })
  });

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "founder-bottlenecks.md");

  await writeFile(runtimePath, markdown, "utf8");
  const structuredFiles = [
    await writeStartupStructuredArtifact({
      kind: "startup_founder_bottleneck",
      generatedAt,
      markdownPath: runtimePath,
      data: {
        bottlenecks,
        owner: options.owner ?? "unassigned",
        systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
        status: options.status ?? "handoff-in-progress",
        handoffDueDate: options.handoffDueDate ?? null
      }
    })
  ];

  const evidence = await addStartupEvidence({
    cwd,
    type: "founder_bottleneck",
    summary: `Founder bottleneck map recorded (${bottlenecks.length} item${bottlenecks.length === 1 ? "" : "s"})`,
    sourceRefs: [runtimePath, ...structuredFiles],
    content: JSON.stringify(
      {
        markdown,
        bottlenecks,
        owner: options.owner ?? "unassigned",
        systemOfRecord: options.systemOfRecord ?? "Runstead evidence ledger",
        status: options.status ?? "handoff-in-progress",
        handoffDueDate: options.handoffDueDate ?? null
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
    bottlenecks
  };
}
