import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { JsonObject } from "@runstead/core";

import type {
  EvidenceProvenanceArtifact,
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import type { CommandVerifierCodeState } from "./verifier-evidence.js";

export type StaleEvidenceReasonGroup =
  | "freshness_expired"
  | "code_fingerprint_mismatch"
  | "superseded_same_subject"
  | "other";

export function currentCommandEvidence(
  data: LaunchReadinessReportData
): EvidenceReportRow[] {
  const stale = staleEvidenceReasons(data);

  return data.evidence
    .filter((item) => item.type === "command_output")
    .filter((item) => !stale.has(item.id));
}

export function staleCommandEvidence(
  data: LaunchReadinessReportData
): EvidenceReportRow[] {
  const stale = staleEvidenceReasons(data);

  return data.evidence
    .filter((item) => item.type === "command_output")
    .filter((item) => stale.has(item.id));
}

export function currentEvidenceRows(
  data: LaunchReadinessReportData
): EvidenceReportRow[] {
  const stale = staleEvidenceReasons(data);

  return data.evidence.filter((item) => !stale.has(item.id));
}

export function staleEvidenceRows(
  data: LaunchReadinessReportData
): EvidenceReportRow[] {
  const stale = staleEvidenceReasons(data);

  return data.evidence.filter((item) => stale.has(item.id));
}

export function staleEvidenceReason(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): string {
  return staleEvidenceReasons(data).get(item.id) ?? "not stale";
}

export function staleEvidenceReasonGroups(data: LaunchReadinessReportData): {
  reason: StaleEvidenceReasonGroup;
  count: number;
}[] {
  const counts = new Map<StaleEvidenceReasonGroup, number>();

  for (const reason of staleEvidenceReasons(data).values()) {
    const group = staleEvidenceReasonGroup(reason);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const groupOrder = [
    "freshness_expired",
    "code_fingerprint_mismatch",
    "superseded_same_subject",
    "other"
  ] as const satisfies readonly StaleEvidenceReasonGroup[];

  return groupOrder.flatMap((reason) => {
    const count = counts.get(reason);

    return count === undefined ? [] : [{ reason, count }];
  });
}

function staleEvidenceReasonGroup(reason: string): StaleEvidenceReasonGroup {
  if (reason.startsWith("source freshness expired")) {
    return "freshness_expired";
  }

  if (reason.includes("code_state=stale")) {
    return "code_fingerprint_mismatch";
  }

  if (reason.startsWith("superseded by newer")) {
    return "superseded_same_subject";
  }

  return "other";
}

export function staleEvidenceReasonGroupLabel(
  reason: StaleEvidenceReasonGroup
): string {
  switch (reason) {
    case "freshness_expired":
      return "source freshness expired";
    case "code_fingerprint_mismatch":
      return "stale code fingerprint";
    case "superseded_same_subject":
      return "superseded by newer same-subject evidence";
    case "other":
      return "other stale evidence";
  }
}

export function staleEvidenceReasons(
  data: LaunchReadinessReportData
): Map<string, string> {
  const reasons = new Map<string, string>();
  const latestCommandEvidence = latestCommandEvidenceByCurrentKey(data);
  const latestStartupEvidence = latestEvidenceByCurrentKey(
    data.evidence.filter((item) => item.type.startsWith("startup_"))
  );

  for (const item of data.evidence) {
    const freshnessReason = staleSourceFreshnessReason(data, item);

    if (freshnessReason !== undefined) {
      reasons.set(item.id, freshnessReason);
      continue;
    }

    if (item.type === "command_output" && isStaleCommandEvidence(data, item)) {
      reasons.set(
        item.id,
        `${commandEvidenceCodeState(data, item)}; ${commandEvidenceGovernance(item)}`
      );
      continue;
    }

    if (item.type === "command_output") {
      const key = commandEvidenceCurrentKey(data, item);
      const latest = latestCommandEvidence.get(key);

      if (latest !== undefined && latest.id !== item.id) {
        reasons.set(item.id, `superseded by newer command evidence for ${key}`);
      }

      continue;
    }

    if (!item.type.startsWith("startup_")) {
      continue;
    }

    const key = evidenceCurrentKey(item);
    const latest = latestStartupEvidence.get(key);

    if (latest !== undefined && latest.id !== item.id) {
      reasons.set(item.id, `superseded by newer evidence for ${key}`);
    }
  }

  return reasons;
}

export function staleSourceFreshnessReason(
  data: LaunchReadinessReportData,
  item: EvidenceReportRow
): string | undefined {
  const generatedAt = Date.parse(data.generatedAt);

  if (Number.isNaN(generatedAt)) {
    return undefined;
  }

  const sources = artifactSources(readEvidenceProvenanceArtifact(item.uri));

  for (const source of sources) {
    const capturedAt = stringValue(source.capturedAt);
    const freshnessDays =
      typeof source.freshnessDays === "number" ? source.freshnessDays : undefined;

    if (capturedAt === undefined || freshnessDays === undefined) {
      continue;
    }

    const capturedAtMs = Date.parse(capturedAt);

    if (Number.isNaN(capturedAtMs)) {
      continue;
    }

    const ageDays = Math.floor((generatedAt - capturedAtMs) / 86_400_000);

    if (ageDays > freshnessDays) {
      const kind = stringValue(source.kind) ?? "unknown";

      return `source freshness expired: ${kind} source is ${ageDays}d old (freshness ${freshnessDays}d)`;
    }
  }

  return undefined;
}

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

export function parsedEvidenceContent(uri: string): unknown {
  const artifact = readEvidenceProvenanceArtifact(uri);

  if (!isRecord(artifact) || typeof artifact.content !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

export function evidenceSourceSummary(item: EvidenceReportRow): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const sources = artifactSources(artifact);

  if (sources.length === 0) {
    return `${item.type} artifact=${item.uri}`;
  }

  return `${item.type} ${sources.map(formatArtifactSource).join("; ")}`;
}

export function readEvidenceProvenanceArtifact(
  uri: string
): EvidenceProvenanceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function artifactSources(
  artifact: EvidenceProvenanceArtifact | undefined
): JsonObject[] {
  if (artifact === undefined || !Array.isArray(artifact.sources)) {
    return [];
  }

  return artifact.sources.filter((source): source is JsonObject => isRecord(source));
}

export function formatArtifactSource(source: JsonObject): string {
  const kind = stringValue(source.kind) ?? "unknown";
  const uri = stringValue(source.uri) ?? "missing";
  const capturedAt = stringValue(source.capturedAt) ?? "unknown";
  const freshness =
    typeof source.freshnessDays === "number"
      ? ` freshness=${source.freshnessDays}d`
      : "";
  const hash = stringValue(source.hash);

  return `source=${kind} uri=${uri} captured=${capturedAt}${freshness}${hash === undefined ? "" : ` hash=${hash}`}`;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
