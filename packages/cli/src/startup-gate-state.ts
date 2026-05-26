import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { hasNonEmptyString, isRecord } from "./startup-gate-artifacts.js";
import type { StartupGateStage } from "./startup-evidence-types.js";
import type {
  StartupGateEvidenceRow,
  StartupGatePreviousEvent,
  StartupGateTaskRow
} from "./startup-gate-evaluation.js";

interface StartupGatePreviousEventRow {
  event_id: string;
  payload_json: string;
}

export function readStartupGateTasks(
  database: RunsteadDatabase,
  domain: string
): StartupGateTaskRow[] {
  return database
    .prepare(
      `
      SELECT id, type, status
      FROM tasks
      WHERE domain = ?
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(domain) as unknown as StartupGateTaskRow[];
}

export function readStartupGateEvidence(
  database: RunsteadDatabase,
  domain: string
): StartupGateEvidenceRow[] {
  return database
    .prepare(
      `
      SELECT DISTINCT e.id, e.type, e.subject_type, e.subject_id, e.uri,
             e.summary, e.created_at
      FROM evidence e
      LEFT JOIN tasks t ON e.subject_type = 'task' AND e.subject_id = t.id
      WHERE t.domain = ?
         OR e.type = 'command_output'
         OR e.type LIKE 'startup_%'
      ORDER BY e.created_at DESC, e.id ASC
    `
    )
    .all(domain) as unknown as StartupGateEvidenceRow[];
}

export function readPreviousStartupGateEvent(
  database: RunsteadDatabase,
  domain: string,
  stage: StartupGateStage
): StartupGatePreviousEvent | undefined {
  const row = database
    .prepare(
      `
      SELECT event_id, payload_json
      FROM events
      WHERE type = 'startup_gate.checked'
        AND aggregate_type = 'startup_gate'
        AND aggregate_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(`${domain}_${stage}`) as StartupGatePreviousEventRow | undefined;

  if (row === undefined) {
    return undefined;
  }

  try {
    const payload = JSON.parse(row.payload_json) as unknown;

    return {
      eventId: row.event_id,
      blockers:
        isRecord(payload) && Array.isArray(payload.blockers)
          ? payload.blockers.filter(hasNonEmptyString)
          : []
    };
  } catch {
    return {
      eventId: row.event_id,
      blockers: []
    };
  }
}
