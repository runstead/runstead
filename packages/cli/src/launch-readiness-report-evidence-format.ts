import type {
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import {
  commandEvidenceCodeState,
  commandEvidenceGovernance,
  currentCommandEvidence,
  currentEvidenceRows,
  evidenceSourceSummary,
  formatCurrentCodeFingerprint,
  isStaleCommandEvidence,
  parsedEvidenceContent,
  staleCommandEvidence,
  staleEvidenceReason,
  staleEvidenceReasonGroupLabel,
  staleEvidenceReasonGroups,
  staleEvidenceRows
} from "./launch-readiness-evidence.js";
import {
  formatTaskCounts,
  isRecord,
  listOrNone,
  stringArrayValue,
  stringValue
} from "./launch-readiness-report-helpers.js";
import { formatScore } from "./launch-readiness-trust.js";

const STALE_EVIDENCE_APPENDIX_LIMIT = 10;

export function metricEvidenceConfidence(data: LaunchReadinessReportData): string {
  const metricEvidence = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_metric_snapshot"
  );

  return listOrNone(metricEvidence, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: source_class=missing confidence=unknown launch_weight=unknown`;
    }

    const sourceClass = stringValue(content.sourceClass) ?? "founder_manual";
    const confidence =
      typeof content.confidence === "number"
        ? formatScore(content.confidence)
        : "unknown";
    const launchWeight =
      typeof content.launchWeight === "number"
        ? formatScore(content.launchWeight)
        : "unknown";
    const realUserData =
      typeof content.realUserData === "boolean"
        ? content.realUserData
          ? "yes"
          : "no"
        : "unknown";

    return [
      `- ${item.id}: metric=${stringValue(content.metric) ?? "unknown"}`,
      `source_class=${sourceClass}`,
      `confidence=${confidence}`,
      `launch_weight=${launchWeight}`,
      `real_user_data=${realUserData}`
    ].join(" ");
  });
}

export function verifierStatus(data: LaunchReadinessReportData): string {
  const verifierTasks = data.tasks.filter(
    (task) => task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers"
  );
  const commandEvidence = currentCommandEvidence(data);
  const staleEvidence = staleCommandEvidence(data);

  return [
    `- Verifier tasks: ${formatTaskCounts(verifierTasks)}`,
    `- Current code fingerprint: ${formatCurrentCodeFingerprint(data.currentCodeState)}`,
    `- Current command evidence records: ${commandEvidence.length}`,
    `- Stale command evidence records: ${staleEvidence.length} (see appendix)`,
    ...commandEvidence.map(
      (item) =>
        `- ${item.id}: ${item.summary ?? item.uri} (${item.created_at}; ${commandEvidenceGovernance(item)}; ${commandEvidenceCodeState(data, item)})`
    )
  ].join("\n");
}

export function staleEvidenceSummary(data: LaunchReadinessReportData): string {
  const current = currentEvidenceRows(data).length;
  const stale = staleEvidenceRows(data).length;
  const groups = staleEvidenceReasonGroups(data);

  if (stale === 0) {
    return [
      `- Current evidence records: ${current}`,
      "- Stale/superseded evidence records: 0"
    ].join("\n");
  }

  return [
    `- Current evidence records: ${current}`,
    `- Stale/superseded evidence records: ${stale}`,
    ...groups.map(
      (group) => `- ${staleEvidenceReasonGroupLabel(group.reason)}: ${group.count}`
    ),
    "- Full stale evidence remains in the JSON artifact and stale evidence appendix."
  ].join("\n");
}

export function staleCommandEvidenceGaps(data: LaunchReadinessReportData): string[] {
  const stale = staleCommandEvidence(data);

  return stale.length === 0
    ? []
    : [
        `${stale.length} verifier evidence record${stale.length === 1 ? "" : "s"} recorded against stale code state; see stale evidence appendix`
      ];
}

export function frontendUiValidation(data: LaunchReadinessReportData): string {
  const rows = currentEvidenceRows(data).filter(
    (item) => item.type === "startup_ui_validation"
  );

  return listOrNone(rows, (item) => {
    const content = parsedEvidenceContent(item.uri);

    if (!isRecord(content)) {
      return `- ${item.id}: ${item.summary ?? item.uri}`;
    }

    return [
      `- ${item.id}: url=${stringValue(content.url) ?? "unknown"}`,
      `viewport=${stringValue(content.viewport) ?? "unknown"}`,
      `dom=${stringValue(content.domStatus) ?? "unknown"}`,
      `accessibility=${stringValue(content.accessibilityStatus) ?? "unknown"}`,
      `responsive=${stringValue(content.responsiveStatus) ?? "unknown"}`,
      `flow=${stringValue(content.criticalFlowStatus) ?? "unknown"}`
    ].join(" ");
  });
}

export function evidenceProvenance(data: LaunchReadinessReportData): string {
  const rows = currentEvidenceRows(data).filter(
    (item) =>
      (item.type === "command_output" && !isStaleCommandEvidence(data, item)) ||
      item.type.startsWith("startup_")
  );

  return listOrNone(rows, (item) => `- ${item.id}: ${evidenceSourceSummary(item)}`);
}

export function changeAuthorship(data: LaunchReadinessReportData): string {
  const currentEvidence = currentEvidenceRows(data);
  const operatorChanges = currentEvidence.filter(
    (item) => item.type === "startup_manual_change"
  );
  const agentEvidence = currentEvidence.filter(
    (item) =>
      item.type === "command_output" ||
      item.task_type === "local_agent_task" ||
      item.summary?.toLowerCase().includes("codex") === true
  );

  return [
    `- Agent change evidence: ${agentEvidence.length}`,
    `- Operator change evidence: ${operatorChanges.length}`,
    ...operatorChanges.map((item) => `- Operator: ${manualChangeSummary(item)}`)
  ].join("\n");
}

export function staleEvidenceAppendix(data: LaunchReadinessReportData): string {
  const rows = staleEvidenceRows(data);
  const visibleRows = rows.slice(0, STALE_EVIDENCE_APPENDIX_LIMIT);
  const omitted = rows.length - visibleRows.length;

  if (rows.length === 0) {
    return "none";
  }

  return [
    `- Total stale records: ${rows.length}; showing ${visibleRows.length}. Full stale evidence remains in the JSON artifact.`,
    ...visibleRows.map(
      (item) =>
        `- ${item.id}: ${item.summary ?? item.uri} (${staleEvidenceReason(data, item)}; ${evidenceSourceSummary(item)})`
    ),
    ...(omitted === 0
      ? []
      : [
          `- ${omitted} additional stale evidence record${omitted === 1 ? "" : "s"} omitted from markdown; inspect staleEvidence in the JSON artifact.`
        ])
  ].join("\n");
}

function manualChangeSummary(item: EvidenceReportRow): string {
  const content = parsedEvidenceContent(item.uri);

  if (!isRecord(content)) {
    return `${item.id}: ${item.summary ?? item.uri}`;
  }

  const actor = stringValue(content.actor) ?? "unknown";
  const reason = stringValue(content.reason) ?? "unspecified";
  const diffSummary = stringValue(content.diffSummary) ?? item.summary ?? "change";
  const commands = stringArrayValue(content.commandsRerun);
  const evidenceRefs = stringArrayValue(content.evidenceRefs);

  return [
    `${item.id}: actor=${actor}`,
    `diff="${diffSummary}"`,
    `reason="${reason}"`,
    `commands=${commands.length === 0 ? "none" : commands.join(",")}`,
    `evidenceRefs=${evidenceRefs.length === 0 ? "none" : evidenceRefs.join(",")}`
  ].join(" ");
}
