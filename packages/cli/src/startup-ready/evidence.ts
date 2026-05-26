import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parsedStartupReadinessArtifactContent,
  stagingDeploymentText,
  startupReadinessArtifactSources,
  startupReadinessEvidenceCodeFingerprintStale,
  startupReadinessEvidenceCurrentKey,
  startupReadinessEvidenceIsStale
} from "@runstead/runtime";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "../runstead-root.js";
import { startupSourceStatusCountsForReadiness } from "../startup-source-evidence-content.js";
import {
  STARTUP_READINESS_EVIDENCE_TIERS,
  type StartupReadinessEvidenceTier
} from "./types.js";
import { isRecord, unique, uniqueEvidenceTiers } from "./shared.js";

export async function collectRecordedStartupReadinessEvidence(
  cwd: string,
  options: { now?: Date; codeFingerprint?: string } = {}
): Promise<{
  evidenceTiers: StartupReadinessEvidenceTier[];
  evidenceTypes: string[];
  staleEvidenceRefs: string[];
  supersededEvidenceRefs: string[];
}> {
  try {
    const state = await requireRunsteadStateDb(cwd);
    const database = openRunsteadDatabase(state.stateDb);
    const checkedAt = (options.now ?? new Date()).toISOString();

    try {
      const rows = database
        .prepare(
          `
          SELECT id, type, uri, summary, created_at AS createdAt
          FROM evidence
          WHERE type = 'command_output' OR type LIKE 'startup_%'
          `
        )
        .all() as unknown as StartupReadinessEvidenceRow[];
      const artifacts = await Promise.all(
        rows.map((row) => readStartupReadinessEvidenceArtifact(row.uri))
      );
      const staleEvidenceRefs = unique(
        rows.flatMap((row, index) =>
          startupReadinessEvidenceIsStale(
            artifacts[index],
            checkedAt,
            options.codeFingerprint
          )
            ? [row.id]
            : []
        )
      );
      const supersededEvidenceRefs = unique(
        supersededStartupReadinessEvidenceRefs(rows, artifacts)
      );
      const excludedRefs = new Set([...staleEvidenceRefs, ...supersededEvidenceRefs]);
      const activeEvidence = rows
        .map((row, index) => ({ row, artifact: artifacts[index] }))
        .filter(({ row }) => !excludedRefs.has(row.id));

      return {
        evidenceTiers: uniqueEvidenceTiers(
          activeEvidence.flatMap(({ row, artifact }) =>
            inferRecordedEvidenceTiers(row, artifact)
          )
        ),
        evidenceTypes: unique(activeEvidence.map(({ row }) => row.type)),
        staleEvidenceRefs,
        supersededEvidenceRefs
      };
    } finally {
      database.close();
    }
  } catch {
    return {
      evidenceTiers: [],
      evidenceTypes: [],
      staleEvidenceRefs: [],
      supersededEvidenceRefs: []
    };
  }
}

export interface StartupReadinessEvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary?: string | null;
  createdAt: string;
}

export function inferRecordedEvidenceTiers(
  row: StartupReadinessEvidenceRow,
  artifact: unknown
): StartupReadinessEvidenceTier[] {
  const structuredSourceTiers = structuredStartupSourceEvidenceTiers(artifact);

  if (structuredSourceTiers !== undefined) {
    return structuredSourceTiers;
  }

  const text = evidenceSearchText(row, artifact);
  const tiers: StartupReadinessEvidenceTier[] = [];

  if (row.type === "command_output") {
    tiers.push("local_command");
  }

  if (row.type === "startup_ui_validation" || text.includes("synthetic")) {
    tiers.push("synthetic_smoke");
  }

  if (text.includes("founder_manual") || text.includes("local_manual")) {
    tiers.push("local_manual");
  }

  if (
    row.type === "startup_ci_summary" ||
    text.includes("github actions") ||
    text.includes("ci_verified") ||
    text.includes("ci verified")
  ) {
    tiers.push("ci_verified");
  }

  if (text.includes("staging_deployment") || stagingDeploymentText(text)) {
    tiers.push("staging_deployment");
  }

  if (
    text.includes("production_deployment") ||
    text.includes("production deployment") ||
    text.includes("prod deployment")
  ) {
    tiers.push("production_deployment");
  }

  if (
    row.type === "startup_metric_snapshot" &&
    (text.includes("analytics_real_user") ||
      text.includes("real_user_analytics") ||
      /realuserdata\\?":\s*true/.test(text))
  ) {
    tiers.push("real_user_analytics");
  }

  if (row.type === "startup_support_triage" || text.includes("support_ticket")) {
    tiers.push("support_ticket");
  }

  if (row.type === "startup_security_baseline" || text.includes("security_scan")) {
    tiers.push("security_scan");
  }

  return uniqueEvidenceTiers(tiers);
}

function structuredStartupSourceEvidenceTiers(
  artifact: unknown
): StartupReadinessEvidenceTier[] | undefined {
  const content = parsedStartupReadinessArtifactContent(artifact);

  if (
    !isRecord(content) ||
    typeof content.connector !== "string" ||
    typeof content.status !== "string" ||
    !Array.isArray(content.readinessTiers)
  ) {
    return undefined;
  }

  if (!startupSourceStatusCountsForReadiness(content.status)) {
    return [];
  }

  return uniqueEvidenceTiers(
    content.readinessTiers.filter(isStartupReadinessEvidenceTier)
  );
}

function isStartupReadinessEvidenceTier(
  value: unknown
): value is StartupReadinessEvidenceTier {
  return (
    typeof value === "string" &&
    (STARTUP_READINESS_EVIDENCE_TIERS as readonly string[]).includes(value)
  );
}

export async function readStartupReadinessEvidenceArtifact(
  uri: string
): Promise<unknown> {
  try {
    const path = uri.startsWith("file:") ? fileURLToPath(uri) : uri;

    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export function evidenceSearchText(
  row: StartupReadinessEvidenceRow,
  artifact: unknown
): string {
  return `${row.type} ${row.uri} ${row.summary ?? ""} ${JSON.stringify(artifact ?? {})}`.toLowerCase();
}

export function supersededStartupReadinessEvidenceRefs(
  rows: StartupReadinessEvidenceRow[],
  artifacts: unknown[]
): string[] {
  const latest = new Map<string, StartupReadinessEvidenceRow>();

  rows.forEach((row, index) => {
    if (!row.type.startsWith("startup_")) {
      return;
    }

    const key = startupReadinessEvidenceCurrentKey(row, artifacts[index]);
    const current = latest.get(key);

    if (
      current === undefined ||
      Date.parse(row.createdAt) > Date.parse(current.createdAt) ||
      (row.createdAt === current.createdAt && row.id.localeCompare(current.id) > 0)
    ) {
      latest.set(key, row);
    }
  });

  return rows.flatMap((row, index) => {
    if (!row.type.startsWith("startup_")) {
      return [];
    }

    const key = startupReadinessEvidenceCurrentKey(row, artifacts[index]);

    return latest.get(key)?.id === row.id ? [] : [row.id];
  });
}

export {
  parsedStartupReadinessArtifactContent,
  stagingDeploymentText,
  startupReadinessArtifactSources,
  startupReadinessEvidenceCodeFingerprintStale,
  startupReadinessEvidenceCurrentKey,
  startupReadinessEvidenceIsStale
};
