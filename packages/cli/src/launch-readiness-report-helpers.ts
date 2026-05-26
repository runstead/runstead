import type { JsonObject } from "@runstead/core";

import type { EvidenceReportRow, TaskReportRow } from "./launch-readiness-data.js";

export function indentList(items: string[]): string {
  return items.map((item) => `  - ${item}`).join("\n");
}

export function formatTaskCounts(tasks: TaskReportRow[]): string {
  if (tasks.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();

  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

export function hasCompletedTask(tasks: TaskReportRow[], type: string): boolean {
  return tasks.some((task) => task.type === type && task.status === "completed");
}

export function hasEvidenceType(evidence: EvidenceReportRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

export function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
