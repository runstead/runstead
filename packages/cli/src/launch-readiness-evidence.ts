import type {
  EvidenceReportRow,
  LaunchReadinessReportData
} from "./launch-readiness-data.js";
import {
  commandEvidenceCodeState,
  commandEvidenceCurrentKey,
  commandEvidenceGovernance,
  evidenceCurrentKey,
  isStaleCommandEvidence,
  latestCommandEvidenceByCurrentKey,
  latestEvidenceByCurrentKey
} from "./launch-readiness-command-evidence.js";
import {
  artifactSources,
  formatArtifactSource,
  readEvidenceProvenanceArtifact,
  stringValue
} from "./launch-readiness-evidence-artifacts.js";

export {
  commandEvidenceCodeState,
  commandEvidenceCurrentKey,
  commandEvidenceGovernance,
  evidenceCurrentKey,
  formatCurrentCodeFingerprint,
  isStaleCommandEvidence,
  latestCommandEvidenceByCurrentKey,
  latestEvidenceByCurrentKey,
  taskInputWorker
} from "./launch-readiness-command-evidence.js";
export {
  artifactSources,
  formatArtifactSource,
  parsedEvidenceContent,
  readEvidenceProvenanceArtifact
} from "./launch-readiness-evidence-artifacts.js";

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

export function evidenceSourceSummary(item: EvidenceReportRow): string {
  const artifact = readEvidenceProvenanceArtifact(item.uri);
  const sources = artifactSources(artifact);

  if (sources.length === 0) {
    return `${item.type} artifact=${item.uri}`;
  }

  return `${item.type} ${sources.map(formatArtifactSource).join("; ")}`;
}
