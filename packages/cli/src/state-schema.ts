import { REQUIRED_STATE_TABLES } from "@runstead/state-sqlite";

export { REQUIRED_STATE_TABLES };

export function missingRequiredStateTables(tableNames: Iterable<string>): string[] {
  const existing = new Set(tableNames);

  return REQUIRED_STATE_TABLES.filter((table) => !existing.has(table));
}
