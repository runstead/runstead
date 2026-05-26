import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { JsonObject, RunsteadEvent } from "@runstead/core";
import type {
  RuntimeArtifactRecord,
  RuntimeArtifactStore,
  RuntimeArtifactWrite,
  RuntimeControlPlaneBackend,
  RuntimeEventAppend,
  RuntimeEventAppendResult,
  RuntimeEventQuery,
  RuntimeEventStore,
  RuntimeLockLease,
  RuntimeLockManager,
  RuntimeLockRequest,
  RuntimeProjectionMutation
} from "@runstead/runtime";

import { runStateTransaction } from "./projections.js";

export interface SqliteControlPlaneBackendOptions {
  database: SqliteDatabase;
  stateUri: string;
  artifactBaseUri?: string;
  close?: () => void;
}

type SqliteDatabase = DatabaseSync;

interface SqliteEventRow {
  id: number;
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

interface SqliteLockRow {
  resource: string;
  owner: string;
  token: string;
  fencing_token: number;
  expires_at: string;
}

export function createSqliteControlPlaneBackend(
  options: SqliteControlPlaneBackendOptions
): RuntimeControlPlaneBackend & { close: () => void } {
  const artifactBaseUri = options.artifactBaseUri ?? `${options.stateUri}#artifacts`;

  return {
    identity: {
      backend: "sqlite",
      stateUri: options.stateUri,
      artifactBaseUri
    },
    events: new SqliteEventStore(options.database),
    locks: new SqliteLockManager(options.database),
    artifacts: new SqliteArtifactStore(options.database, artifactBaseUri),
    close: () => options.close?.()
  };
}

class SqliteEventStore implements RuntimeEventStore {
  constructor(private readonly database: SqliteDatabase) {}

  async append(entries: RuntimeEventAppend[]): Promise<RuntimeEventAppendResult[]> {
    await Promise.resolve();

    if (entries.length === 0) {
      return [];
    }

    return runStateTransaction(this.database, () => {
      const results: RuntimeEventAppendResult[] = [];

      for (const entry of entries) {
        if (entry.idempotencyKey !== undefined) {
          const existing = this.idempotentResult(entry.idempotencyKey);

          if (existing !== undefined) {
            results.push(existing);
            continue;
          }
        }

        const currentRevision = this.aggregateRevision(entry.event);

        if (
          entry.expectedRevision !== undefined &&
          currentRevision !== entry.expectedRevision
        ) {
          throw new SqliteRevisionConflictError(
            entry.event.aggregateType,
            entry.event.aggregateId,
            entry.expectedRevision,
            currentRevision
          );
        }

        this.insertEvent(entry.event);

        if (entry.projection !== undefined) {
          this.upsertProjection(entry.projection);
        }

        const result = {
          eventId: entry.event.eventId,
          aggregateType: entry.event.aggregateType,
          aggregateId: entry.event.aggregateId,
          revision: currentRevision + 1
        };

        if (entry.idempotencyKey !== undefined) {
          this.recordIdempotentResult(entry.idempotencyKey, result, entry.event);
        }

        results.push(result);
      }

      return results;
    });
  }

  async read(query: RuntimeEventQuery = {}): Promise<RunsteadEvent[]> {
    await Promise.resolve();

    const clauses: string[] = [];
    const params: (number | string)[] = [];

    if (query.type !== undefined) {
      clauses.push("type = ?");
      params.push(query.type);
    }

    if (query.aggregateType !== undefined) {
      clauses.push("aggregate_type = ?");
      params.push(query.aggregateType);
    }

    if (query.aggregateId !== undefined) {
      clauses.push("aggregate_id = ?");
      params.push(query.aggregateId);
    }

    if (query.afterRevision !== undefined) {
      clauses.push("id > ?");
      params.push(query.afterRevision);
    }

    const limit = query.limit === undefined ? 1_000 : Math.max(1, query.limit);
    const rows = this.database
      .prepare(
        `
        SELECT id, event_id, type, aggregate_type, aggregate_id, payload_json, created_at
        FROM events
        ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
        ORDER BY id ASC
        LIMIT ?
      `
      )
      .all(...params, limit) as unknown as SqliteEventRow[];

    return rows.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: jsonObject(row.payload_json),
      createdAt: row.created_at
    }));
  }

  private aggregateRevision(event: RunsteadEvent): number {
    const row = this.database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM events
        WHERE aggregate_type = ? AND aggregate_id = ?
      `
      )
      .get(event.aggregateType, event.aggregateId) as { count: number };

    return row.count;
  }

  private idempotentResult(
    idempotencyKey: string
  ): RuntimeEventAppendResult | undefined {
    const row = this.database
      .prepare(
        `
        SELECT result_json
        FROM runtime_event_idempotency
        WHERE idempotency_key = ?
      `
      )
      .get(idempotencyKey) as { result_json: string } | undefined;

    return row === undefined
      ? undefined
      : runtimeEventAppendResult(JSON.parse(row.result_json) as unknown);
  }

  private recordIdempotentResult(
    idempotencyKey: string,
    result: RuntimeEventAppendResult,
    event: RunsteadEvent
  ): void {
    this.database
      .prepare(
        `
        INSERT INTO runtime_event_idempotency (idempotency_key, result_json, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
      `
      )
      .run(idempotencyKey, JSON.stringify(result), event.createdAt);
  }

  private insertEvent(event: RunsteadEvent): void {
    this.database
      .prepare(
        `
        INSERT INTO events (
          event_id,
          type,
          aggregate_type,
          aggregate_id,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        event.eventId,
        event.type,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.createdAt
      );
  }

  private upsertProjection(projection: RuntimeProjectionMutation): void {
    const projected = runtimeProjectionRecord(projection);

    this.database
      .prepare(
        `
        INSERT INTO runtime_projections (
          projection_type,
          aggregate_type,
          aggregate_id,
          payload_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(projection_type, aggregate_id) DO UPDATE SET
          aggregate_type = excluded.aggregate_type,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `
      )
      .run(
        projected.projectionType,
        projected.aggregateType,
        projected.aggregateId,
        JSON.stringify(projected.value),
        new Date().toISOString()
      );
  }
}

class SqliteLockManager implements RuntimeLockManager {
  constructor(private readonly database: SqliteDatabase) {}

  async acquire(request: RuntimeLockRequest): Promise<RuntimeLockLease> {
    await Promise.resolve();

    return runStateTransaction(this.database, () => {
      const now = request.now ?? new Date();
      const current = this.database
        .prepare(
          `
          SELECT resource, owner, token, fencing_token, expires_at
          FROM runtime_locks
          WHERE resource = ?
        `
        )
        .get(request.resource) as SqliteLockRow | undefined;

      if (
        current !== undefined &&
        Date.parse(current.expires_at) > now.getTime() &&
        current.owner !== request.owner
      ) {
        throw new SqliteLockUnavailableError(
          request.resource,
          current.owner,
          current.expires_at
        );
      }

      const fencingToken = (current?.fencing_token ?? 0) + 1;
      const token = `lease_${fencingToken}_${randomUUID()}`;
      const expiresAt = new Date(now.getTime() + request.ttlMs).toISOString();

      this.database
        .prepare(
          `
          INSERT INTO runtime_locks (
            resource,
            owner,
            token,
            fencing_token,
            expires_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(resource) DO UPDATE SET
            owner = excluded.owner,
            token = excluded.token,
            fencing_token = excluded.fencing_token,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `
        )
        .run(
          request.resource,
          request.owner,
          token,
          fencingToken,
          expiresAt,
          now.toISOString()
        );

      return this.lease({
        resource: request.resource,
        owner: request.owner,
        token,
        fencingToken: String(fencingToken),
        expiresAt
      });
    });
  }

  private lease(input: {
    resource: string;
    owner: string;
    token: string;
    fencingToken: string;
    expiresAt: string;
  }): RuntimeLockLease {
    return {
      resource: input.resource,
      owner: input.owner,
      token: input.token,
      fencingToken: input.fencingToken,
      expiresAt: input.expiresAt,
      release: async () => {
        await Promise.resolve();
        this.database
          .prepare(
            `
            UPDATE runtime_locks
            SET expires_at = ?, updated_at = ?
            WHERE resource = ? AND token = ?
          `
          )
          .run(
            new Date(0).toISOString(),
            new Date().toISOString(),
            input.resource,
            input.token
          );
      },
      renew: async (ttlMs) => {
        await Promise.resolve();
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        const row = this.database
          .prepare(
            `
            UPDATE runtime_locks
            SET expires_at = ?, updated_at = ?
            WHERE resource = ? AND token = ?
            RETURNING resource, owner, token, fencing_token, expires_at
          `
          )
          .get(expiresAt, new Date().toISOString(), input.resource, input.token) as
          | SqliteLockRow
          | undefined;

        if (row === undefined) {
          throw new Error(`Cannot renew expired or superseded lease ${input.resource}`);
        }

        return this.lease({
          resource: row.resource,
          owner: row.owner,
          token: row.token,
          fencingToken: String(row.fencing_token),
          expiresAt: row.expires_at
        });
      }
    };
  }
}

class SqliteArtifactStore implements RuntimeArtifactStore {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly artifactBaseUri: string
  ) {}

  async write(artifact: RuntimeArtifactWrite): Promise<RuntimeArtifactRecord> {
    await Promise.resolve();

    const contents = artifactBytes(artifact.contents);
    const sha256 = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
    const uri = `${this.artifactBaseUri.replace(/\/+$/u, "")}/${artifact.path.replace(/^\/+/u, "")}`;

    this.database
      .prepare(
        `
        INSERT INTO runtime_artifacts (
          uri,
          path,
          content_type,
          sha256,
          metadata_json,
          contents,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uri) DO UPDATE SET
          content_type = excluded.content_type,
          sha256 = excluded.sha256,
          metadata_json = excluded.metadata_json,
          contents = excluded.contents
      `
      )
      .run(
        uri,
        artifact.path,
        artifact.contentType,
        sha256,
        JSON.stringify(artifact.metadata ?? {}),
        Buffer.from(contents),
        new Date().toISOString()
      );

    return {
      uri,
      contentType: artifact.contentType,
      sha256,
      ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata })
    };
  }

  async read(uri: string): Promise<Uint8Array> {
    await Promise.resolve();

    const row = this.database
      .prepare("SELECT contents FROM runtime_artifacts WHERE uri = ?")
      .get(uri) as { contents: Uint8Array } | undefined;

    if (row === undefined) {
      throw new Error(`Runstead artifact not found: ${uri}`);
    }

    return artifactBytes(row.contents);
  }
}

export class SqliteRevisionConflictError extends Error {
  constructor(
    aggregateType: string,
    aggregateId: string,
    expected: number,
    actual: number
  ) {
    super(
      `Revision conflict for ${aggregateType}:${aggregateId}: expected ${expected}, got ${actual}`
    );
    this.name = "SqliteRevisionConflictError";
  }
}

export class SqliteLockUnavailableError extends Error {
  constructor(resource: string, owner: string, expiresAt: string) {
    super(`SQLite lock ${resource} is held by ${owner} until ${expiresAt}`);
    this.name = "SqliteLockUnavailableError";
  }
}

function runtimeProjectionRecord(projection: RuntimeProjectionMutation): {
  projectionType: string;
  aggregateType: string;
  aggregateId: string;
  value: JsonObject;
} {
  switch (projection.type) {
    case "task":
      return {
        projectionType: projection.type,
        aggregateType: "task",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "evidence":
      return {
        projectionType: projection.type,
        aggregateType: "evidence",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "policyDecision":
      return {
        projectionType: projection.type,
        aggregateType: "policy_decision",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "approval":
      return {
        projectionType: projection.type,
        aggregateType: "approval",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "workerRun":
      return {
        projectionType: projection.type,
        aggregateType: "worker_run",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "toolCall":
      return {
        projectionType: projection.type,
        aggregateType: "tool_call",
        aggregateId: projection.value.id,
        value: projection.value
      };
    case "custom":
      return {
        projectionType: projection.type,
        aggregateType: projection.aggregateType,
        aggregateId: projection.aggregateId,
        value: projection.value
      };
  }
}

function runtimeEventAppendResult(value: unknown): RuntimeEventAppendResult {
  const parsed = jsonObject(value);
  const eventId = stringProperty(parsed, "eventId");
  const aggregateType = stringProperty(parsed, "aggregateType");
  const aggregateId = stringProperty(parsed, "aggregateId");
  const revision = parsed.revision;

  return {
    eventId,
    aggregateType,
    aggregateId,
    ...(typeof revision === "number" ? { revision } : {})
  };
}

function jsonObject(value: unknown): JsonObject {
  if (typeof value === "string") {
    return jsonObject(JSON.parse(value) as unknown);
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
}

function stringProperty(value: JsonObject, key: string): string {
  const parsed = value[key];

  if (typeof parsed !== "string" || parsed.length === 0) {
    throw new Error(`SQLite control-plane row is missing ${key}`);
  }

  return parsed;
}

function artifactBytes(value: unknown): Uint8Array {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }

  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  throw new Error("Unsupported SQLite artifact byte payload");
}
