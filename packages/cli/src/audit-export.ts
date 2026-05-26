import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { readAuditEntries } from "./audit-export-data.js";
export { formatAuditReplay, formatAuditTimeline } from "./audit-export-format.js";
export { replayAuditLifecycle } from "./audit-export-lifecycle.js";
import { requireRunsteadStateDbSync } from "./runstead-root.js";
import type {
  ExportAuditLogOptions,
  ExportAuditLogResult
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
