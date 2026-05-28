import { dirname } from "node:path";

import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  storeRepoInspectionEvidence,
  type RepoInspectionSnapshot
} from "../inspection-evidence.js";
import {
  readLatestWorkspaceFacts,
  type WorkspaceFactsEvidenceSummary
} from "./workspace-facts-cache.js";

export { readLatestWorkspaceFacts } from "./workspace-facts-cache.js";

export async function readWorkspaceFacts(input: {
  cwd: string;
  evidenceDir: string;
  database: RunsteadDatabase;
  refresh: boolean;
  now?: Date;
}): Promise<{
  cached: boolean;
  evidence: WorkspaceFactsEvidenceSummary;
  facts: RepoInspectionSnapshot;
}> {
  if (!input.refresh) {
    const cached = await readLatestWorkspaceFacts(input.database);

    if (cached !== undefined) {
      return {
        cached: true,
        evidence: cached.evidence,
        facts: cached.facts
      };
    }
  }

  const stored = await storeRepoInspectionEvidence({
    cwd: input.cwd,
    runsteadRoot: dirname(input.evidenceDir),
    database: input.database,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    cached: false,
    evidence: {
      id: stored.evidence.id,
      type: stored.evidence.type,
      subjectType: stored.evidence.subjectType,
      subjectId: stored.evidence.subjectId,
      uri: stored.evidence.uri,
      ...(stored.evidence.hash === undefined ? {} : { hash: stored.evidence.hash }),
      ...(stored.evidence.summary === undefined
        ? {}
        : { summary: stored.evidence.summary }),
      createdAt: stored.evidence.createdAt
    },
    facts: stored.snapshot
  };
}
