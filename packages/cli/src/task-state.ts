import type { RunsteadEvent } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDbSync } from "./runstead-root.js";

export function resolveTaskStateDb(cwd = process.cwd()): string {
  return requireRunsteadStateDbSync(cwd).stateDb;
}

export function insertTaskEvent(
  database: RunsteadDatabase,
  event: RunsteadEvent
): void {
  database
    .prepare(
      `
      INSERT INTO events (
        event_id,
        type,
        aggregate_type,
        aggregate_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      event.eventId,
      event.type,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.createdAt
    );
}
