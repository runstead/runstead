import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isRecord,
  type StartupGateEvidenceArtifact
} from "./startup-gate-artifacts.js";

export interface StartupGateEvidenceArtifactRow {
  id: string;
  uri: string;
}

export function readStartupGateEvidenceArtifacts(
  evidence: StartupGateEvidenceArtifactRow[]
): Map<string, StartupGateEvidenceArtifact> {
  const artifacts = new Map<string, StartupGateEvidenceArtifact>();

  for (const item of evidence) {
    const artifact = readStartupGateEvidenceArtifact(item.uri);

    if (artifact !== undefined) {
      artifacts.set(item.id, artifact);
    }
  }

  return artifacts;
}

export function readStartupGateEvidenceArtifact(
  uri: string
): StartupGateEvidenceArtifact | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(uri), "utf8")) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
