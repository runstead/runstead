import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  readAuditEntries,
  readAuditEntriesReferencingIds
} from "./audit-export-data.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import type {
  AuditLogEntry,
  ExportAuditLogOptions,
  ExportAuditLogResult,
  ReplayAuditLifecycleOptions,
  ReplayAuditLifecycleResult
} from "./audit-export-types.js";

export type {
  AuditLogEntry,
  ExportAuditLogOptions,
  ExportAuditLogResult,
  ReplayAuditLifecycleOptions,
  ReplayAuditLifecycleResult
} from "./audit-export-types.js";

export async function exportAuditLog(
  options: ExportAuditLogOptions = {}
): Promise<ExportAuditLogResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const stateDb = resolvedState.stateDb;
  const database = openRunsteadDatabase(stateDb);

  try {
    const entries = readAuditEntries(database, options);
    const contents =
      entries.length === 0
        ? ""
        : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const outputPath =
      options.outputPath === undefined ? undefined : resolve(options.outputPath);

    if (outputPath !== undefined) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents, "utf8");
    }

    return {
      root: resolvedState.root,
      stateDb,
      entries,
      contents,
      ...(outputPath === undefined ? {} : { outputPath })
    };
  } finally {
    database.close();
  }
}

export function formatAuditTimeline(entries: AuditLogEntry[]): string {
  if (entries.length === 0) {
    return "No audit events.";
  }

  return entries
    .map((entry) =>
      [
        String(entry.id).padStart(4, " "),
        entry.createdAt,
        entry.type,
        `${entry.aggregateType}:${entry.aggregateId}`,
        auditPayloadSummary(entry.payload)
      ]
        .filter((part) => part.length > 0)
        .join(" ")
    )
    .join("\n");
}

export function replayAuditLifecycle(
  options: ReplayAuditLifecycleOptions
): Promise<ReplayAuditLifecycleResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = requireRunsteadStateDbSync(cwd);
  const database = openRunsteadDatabase(resolvedState.stateDb);

  try {
    const { entries, relatedIds } = collectAuditLifecycleEntriesFromDatabase(
      database,
      options.taskId
    );

    return Promise.resolve({
      root: resolvedState.root,
      stateDb: resolvedState.stateDb,
      taskId: options.taskId,
      relatedIds,
      entries
    });
  } finally {
    database.close();
  }
}

export function formatAuditReplay(result: ReplayAuditLifecycleResult): string {
  if (result.entries.length === 0) {
    return `No audit events found for task ${result.taskId}.`;
  }

  return [
    `Replay task: ${result.taskId}`,
    `Related ids: ${result.relatedIds.join(", ")}`,
    formatAuditTimeline(result.entries)
  ].join("\n");
}

function collectAuditLifecycleEntriesFromDatabase(
  database: ReturnType<typeof openRunsteadDatabase>,
  taskId: string
): { entries: AuditLogEntry[]; relatedIds: string[] } {
  const relatedIds = new Set<string>([taskId]);
  const selectedIds = new Set<number>();
  const selectedEntries = new Map<number, AuditLogEntry>();
  let changed = true;

  while (changed) {
    changed = false;
    const entries = readAuditEntriesReferencingIds(database, relatedIds, selectedIds);

    for (const entry of entries) {
      if (!entryReferencesAnyId(entry, relatedIds)) {
        continue;
      }

      selectedIds.add(entry.id);
      selectedEntries.set(entry.id, entry);
      changed = true;
      relatedIds.add(entry.aggregateId);

      for (const id of collectReferenceIds(entry.payload)) {
        relatedIds.add(id);
      }
    }
  }

  return {
    entries: [...selectedEntries.values()].sort((left, right) => left.id - right.id),
    relatedIds: [...relatedIds].sort()
  };
}

function entryReferencesAnyId(entry: AuditLogEntry, ids: Set<string>): boolean {
  return (
    ids.has(entry.aggregateId) ||
    collectReferenceIds(entry.payload).some((id) => ids.has(id))
  );
}

function collectReferenceIds(value: unknown): string[] {
  const ids: string[] = [];
  collectReferenceIdsInto(value, ids);
  return ids;
}

function collectReferenceIdsInto(value: unknown, ids: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferenceIdsInto(item, ids);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isReferenceIdKey(key)) {
      if (typeof child === "string") {
        ids.push(child);
      } else if (Array.isArray(child)) {
        ids.push(...child.filter((item): item is string => typeof item === "string"));
      }
    }

    collectReferenceIdsInto(child, ids);
  }
}

function isReferenceIdKey(key: string): boolean {
  return key === "id" || key.endsWith("Id") || key.endsWith("Ids");
}

function auditPayloadSummary(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const parts = [
    stringSummary("action", record.actionType),
    stringSummary("status", record.status),
    stringSummary("decision", record.decision),
    stringSummary("approval", record.approvalId),
    stringSummary("worker", record.workerType),
    stringSummary("task", record.taskId)
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? "" : `[${parts.join(" ")}]`;
}

function stringSummary(label: string, value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? `${label}=${value}`
    : undefined;
}
