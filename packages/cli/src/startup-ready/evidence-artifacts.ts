import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface StartupReadinessEvidenceRow {
  id: string;
  type: string;
  uri: string;
  summary?: string | null;
  createdAt: string;
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
