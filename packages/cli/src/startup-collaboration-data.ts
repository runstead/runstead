import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { openRunsteadDatabase } from "@runstead/state-sqlite";

import type {
  StartupCollaborationApproval,
  StartupRiskAcceptance
} from "./startup-collaboration-types.js";

interface ApprovalRow {
  id: string;
  status: string;
  risk: string;
  reason: string;
  action_id: string;
  requested_by: string | null;
  expires_at: string | null;
  decided_by: string | null;
}

interface EvidenceRow {
  id: string;
  uri: string;
  summary: string | null;
}

export function readCollaborationApprovals(
  database: ReturnType<typeof openRunsteadDatabase>
): StartupCollaborationApproval[] {
  const rows = database
    .prepare(
      `
      SELECT id, status, risk, reason, action_id, requested_by, expires_at, decided_by
      FROM approvals
      ORDER BY created_at DESC, id ASC
    `
    )
    .all() as unknown as ApprovalRow[];

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    actionId: row.action_id,
    requestedBy: row.requested_by ?? "unknown",
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.decided_by === null ? {} : { decidedBy: row.decided_by })
  }));
}

export async function readRiskAcceptances(
  database: ReturnType<typeof openRunsteadDatabase>
): Promise<StartupRiskAcceptance[]> {
  const rows = database
    .prepare(
      `
      SELECT id, uri, summary
      FROM evidence
      WHERE type = 'startup_decision'
      ORDER BY created_at DESC, id ASC
    `
    )
    .all() as unknown as EvidenceRow[];
  const acceptances: StartupRiskAcceptance[] = [];

  for (const row of rows) {
    const content = await readStartupEvidenceContent(row);

    if (!isRecord(content)) {
      continue;
    }

    if (
      content.kind !== "gate_waiver" &&
      content.decision !== "launch_with_accepted_debt"
    ) {
      continue;
    }

    acceptances.push({
      evidenceId: row.id,
      gate: stringValue(content.gate, "unknown"),
      decision: stringValue(content.decision, "unknown"),
      reason: stringValue(content.reason, row.summary ?? "no reason recorded"),
      owner: stringValue(content.owner, "unassigned"),
      ...(typeof content.blocker === "string" ? { blocker: content.blocker } : {}),
      ...(typeof content.expiresAt === "string"
        ? { expiresAt: content.expiresAt }
        : {}),
      ...(typeof content.comment === "string" ? { comment: content.comment } : {})
    });
  }

  return acceptances;
}

async function readStartupEvidenceContent(row: EvidenceRow): Promise<unknown> {
  try {
    const artifact = JSON.parse(
      await readFile(fileURLToPath(row.uri), "utf8")
    ) as unknown;

    if (!isRecord(artifact) || typeof artifact.content !== "string") {
      return undefined;
    }

    return JSON.parse(artifact.content) as unknown;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
