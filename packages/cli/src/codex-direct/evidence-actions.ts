import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import {
  storeRepoInspectionEvidence,
  type RepoInspectionSnapshot
} from "../inspection-evidence.js";
import { discoverVerifierCommands } from "../verifier-discovery.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";
import { isRecord } from "./tool-arguments.js";
import type { CodexDirectWorkerOptions } from "./worker.js";

export async function resolveVerifierCommand(
  options: Pick<CodexDirectWorkerOptions, "cwd" | "task"> & { name: string }
): Promise<CommandVerifierInput> {
  const declared = declaredVerifierCommands(options.task);
  const discovered = await discoverVerifierCommands({ cwd: options.cwd });
  const candidates = [...declared, ...discovered];
  const command = candidates.find((candidate) => candidate.name === options.name);

  if (command === undefined) {
    throw new Error(
      `Verifier not available: ${options.name}. Available verifiers: ${
        candidates.map((candidate) => candidate.name).join(", ") || "none"
      }`
    );
  }

  return command;
}

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

export async function readWorkspaceFacts(input: {
  cwd: string;
  evidenceDir: string;
  database: RunsteadDatabase;
  refresh: boolean;
  now?: Date;
}): Promise<{
  cached: boolean;
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

export async function readLatestWorkspaceFacts(database: RunsteadDatabase): Promise<
  | {
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
      facts: RepoInspectionSnapshot;
    }
  | undefined
> {
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

export function filePathFromEvidenceUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);

    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}

export function declaredVerifierCommands(task: Task): CommandVerifierInput[] {
  const commands = task.input.commands;

  if (!Array.isArray(commands)) {
    return [];
  }

  return commands.flatMap((command) => {
    if (!isRecord(command)) {
      return [];
    }

    const name = command.name;
    const commandText = command.command;

    return typeof name === "string" && typeof commandText === "string"
      ? [{ name, command: commandText }]
      : [];
  });
}

export function previewText(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 500)}...`;
}
