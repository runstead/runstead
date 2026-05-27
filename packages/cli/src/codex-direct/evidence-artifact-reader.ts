import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

export async function readEvidenceArtifact(input: {
  database: RunsteadDatabase;
  evidenceId: string;
  maxBytes: number;
}): Promise<{
  evidence: {
    id: string;
    type: string;
    subjectType: string;
    subjectId: string;
    uri: string;
    hash?: string;
    summary?: string;
    createdAt: string;
  };
  artifact?: {
    path: string;
    content: string;
    bytes: number;
    returnedBytes: number;
    truncated: boolean;
  };
}> {
  const row = input.database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
      FROM evidence
      WHERE id = ?
    `
    )
    .get(input.evidenceId) as
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
    throw new Error(`Evidence not found: ${input.evidenceId}`);
  }

  const evidence = {
    id: row.id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    uri: row.uri,
    ...(row.hash === null ? {} : { hash: row.hash }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at
  };
  const artifactPath = filePathFromEvidenceUri(row.uri);

  if (artifactPath === undefined) {
    return {
      evidence
    };
  }

  const content = await readFile(artifactPath, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  const truncated = bytes > input.maxBytes;
  const returnedContent = truncated ? content.slice(0, input.maxBytes) : content;

  return {
    evidence,
    artifact: {
      path: artifactPath,
      content: returnedContent,
      bytes,
      returnedBytes: Buffer.byteLength(returnedContent, "utf8"),
      truncated
    }
  };
}

export function filePathFromEvidenceUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);

    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}
