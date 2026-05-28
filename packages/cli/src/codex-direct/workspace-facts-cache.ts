import { readFile } from "node:fs/promises";

import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { RepoInspectionSnapshot } from "../inspection-evidence.js";
import { filePathFromEvidenceUri } from "./evidence-artifact-reader.js";

export interface WorkspaceFactsEvidenceSummary {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  uri: string;
  hash?: string;
  summary?: string;
  createdAt: string;
}

export interface CachedWorkspaceFacts {
  evidence: WorkspaceFactsEvidenceSummary;
  facts: RepoInspectionSnapshot;
}

export async function readLatestWorkspaceFacts(
  database: RunsteadDatabase
): Promise<CachedWorkspaceFacts | undefined> {
  const row = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
      FROM evidence
      WHERE type = 'repo_inspection'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    )
    .get() as
    | {
        id: string;
        type: string;
        subject_type: string;
        subject_id: string;
        uri: string;
        hash: string | null;
        summary: string | null;
        created_at: string;
      }
    | undefined;

  if (row === undefined) {
    return undefined;
  }

  const artifactPath = filePathFromEvidenceUri(row.uri);

  if (artifactPath === undefined) {
    return undefined;
  }

  const facts = JSON.parse(
    await readFile(artifactPath, "utf8")
  ) as RepoInspectionSnapshot;

  return {
    evidence: {
      id: row.id,
      type: row.type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      uri: row.uri,
      ...(row.hash === null ? {} : { hash: row.hash }),
      ...(row.summary === null ? {} : { summary: row.summary }),
      createdAt: row.created_at
    },
    facts
  };
}
