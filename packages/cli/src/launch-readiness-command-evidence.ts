import type {
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import {
  isEvidenceRecord as isRecord,
  parsedEvidenceContent,
  readEvidenceProvenanceArtifact,
  stringValue
} from "./launch-readiness-evidence-artifacts.js";
import type { CommandVerifierCodeState } from "./verifier-evidence.js";

export function latestCommandEvidenceByCurrentKey(
  data: LaunchReadinessReportData
): Map<string, EvidenceReportRow> {
  return latestEvidenceByCurrentKey(
    data.evidence
      .filter((item) => item.type === "command_output")
      .filter((item) => !isStaleCommandEvidence(data, item)),
    (item) => commandEvidenceCurrentKey(data, item)
  );
}

export function latestEvidenceByCurrentKey(
  rows: EvidenceReportRow[],
  keyForRow: (row: EvidenceReportRow) => string = evidenceCurrentKey
): Map<string, EvidenceReportRow> {
  const latest = new Map<string, EvidenceReportRow>();

  for (const row of rows) {
    const key = keyForRow(row);
    const current = latest.get(key);

    if (
      current === undefined ||
      Date.parse(row.created_at) > Date.parse(current.created_at) ||
      (row.created_at === current.created_at && row.id.localeCompare(current.id) > 0)
    ) {
      latest.set(key, row);
    }
  }

  return latest;
}

export function commandEvidenceCurrentKey(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const codeState = isRecord(artifact?.codeState) ? artifact.codeState : undefined;
  const fingerprint =
    codeState === undefined
      ? data.currentCodeState.fingerprint
      : (stringValue(codeState.fingerprint) ?? "missing");
  const verifier = stringValue(artifact?.verifier) ?? item.summary ?? item.id;
  const command = stringValue(artifact?.command) ?? "unknown";

  return [
    "command_output",
    commandEvidenceGovernance(item),
    verifier,
    command,
    fingerprint
  ].join(":");
}

export function evidenceCurrentKey(item: EvidenceReportRow): string {
  if (item.type === "startup_ui_validation") {
    const content = parsedEvidenceContent(item.uri);
    const url = isRecord(content) ? stringValue(content.url) : undefined;
    const viewport = isRecord(content) ? stringValue(content.viewport) : undefined;

    return `${item.type}:${url ?? item.subject_id}:${viewport ?? "unknown"}`;
  }

  if (item.type === "startup_metric" || item.type === "startup_metric_snapshot") {
    const content = parsedEvidenceContent(item.uri);
    const metric = isRecord(content) ? stringValue(content.metric) : undefined;

    return `${item.type}:${metric ?? item.subject_id}`;
  }

  return item.type;
}

export function isStaleCommandEvidence(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): boolean {
  return commandEvidenceCodeState(data, item).startsWith("code_state=stale");
}

export function commandEvidenceGovernance(item: EvidenceReportRow): string {
  if (item.task_type === "local_agent_task") {
    const worker = taskInputWorker(item.task_input_json);

    if (worker === "codex_direct") {
      return "codex_direct governed verifier evidence";
    }

    if (worker === "codex_cli" || worker === "claude_code") {
      return "wrapped worker post-run verifier evidence";
    }

    return "local agent post-run verifier evidence";
  }

  if (
    item.task_type === "run_mvp_verifiers" ||
    item.task_type === "run_local_verifiers"
  ) {
    return "Runstead verifier task evidence";
  }

  return "command verifier evidence";
}

export function taskInputWorker(inputJson: string | null): string | undefined {
  if (inputJson === null) {
    return undefined;
  }

  try {
    const input = JSON.parse(inputJson) as unknown;

    return isRecord(input) && typeof input.worker === "string"
      ? input.worker
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatCurrentCodeFingerprint(
  codeState: CommandVerifierCodeState
): string {
  return codeState.available
    ? `${codeState.fingerprint}${codeState.dirty ? " dirty" : " clean"}`
    : "unavailable";
}

export function commandEvidenceCodeState(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const codeState = isRecord(artifact?.codeState) ? artifact.codeState : undefined;
  const fingerprint =
    codeState === undefined ? undefined : stringValue(codeState.fingerprint);

  if (fingerprint === undefined) {
    return "code_state=missing";
  }

  return fingerprint === data.currentCodeState.fingerprint
    ? "code_state=current"
    : `code_state=stale current=${data.currentCodeState.fingerprint}`;
}
