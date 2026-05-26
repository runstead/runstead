import { createHash, randomUUID } from "node:crypto";

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
  RuntimeProjectionMutation,
  RuntimeRunnerHeartbeatInput,
  RuntimeRunnerListQuery,
  RuntimeRunnerRegistration,
  RuntimeRunnerRegistry,
  RuntimeTeamControlPlaneProfile
} from "@runstead/runtime";

export { PsqlPostgresControlPlaneClient } from "./psql-client.js";
export type { PsqlPostgresControlPlaneClientOptions } from "./psql-client.js";
export { NodePostgresControlPlaneClient } from "./node-postgres-client.js";
export type {
  NodePostgresControlPlaneClientOptions,
  NodePostgresDriverClient,
  NodePostgresDriverQueryResult
} from "./node-postgres-client.js";

export const POSTGRES_CONTROL_PLANE_SCHEMA_VERSION = 2;

export type PostgresRow = Record<string, unknown>;

export interface PostgresQueryResult<Row extends PostgresRow = PostgresRow> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PostgresControlPlaneClient {
  query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresControlPlaneOptions {
  client: PostgresControlPlaneClient;
  stateUri: string;
  schema?: string;
  artifactBaseUri?: string;
}

export interface PostgresTeamControlPlaneProfileOptions {
  organizationId: string;
  stateUri: string;
  artifactBaseUri: string;
  runnerIds: string[];
  auditSinkUri: string;
  workspaceId?: string;
}

export interface PostgresControlPlaneMigrationPlan {
  schema: string;
  targetVersion: number;
  statements: string[];
}

interface PostgresMigration {
  version: number;
  name: string;
  sql: string[];
}

interface PostgresSchemaNames {
  schema: string;
  schemaIdentifier: string;
  migrations: string;
  events: string;
  projections: string;
  idempotency: string;
  locks: string;
  artifacts: string;
  runners: string;
}

export function createPostgresControlPlaneBackend(
  options: PostgresControlPlaneOptions
): RuntimeControlPlaneBackend {
  const schema = postgresSchemaNames(options.schema);
  const artifactBaseUri =
    options.artifactBaseUri ?? `${options.stateUri.replace(/\/+$/u, "")}/artifacts`;

  return {
    identity: {
      backend: "postgres",
      stateUri: options.stateUri,
      artifactBaseUri
    },
    events: new PostgresEventStore(options.client, schema),
    locks: new PostgresLockManager(options.client, schema),
    artifacts: new PostgresArtifactStore(options.client, schema, artifactBaseUri),
    runners: new PostgresRunnerRegistry(options.client, schema)
  };
}

export async function migratePostgresControlPlane(
  client: PostgresControlPlaneClient,
  options: { schema?: string } = {}
): Promise<void> {
  const schema = postgresSchemaNames(options.schema);

  await runPostgresTransaction(client, async () => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema.schemaIdentifier}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema.migrations} (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `);

    const applied = await client.query<{ version: number; checksum: string }>(
      `SELECT version, checksum FROM ${schema.migrations} ORDER BY version ASC`
    );
    const currentVersion = Math.max(0, ...applied.rows.map((row) => row.version));

    if (currentVersion > POSTGRES_CONTROL_PLANE_SCHEMA_VERSION) {
      throw new Error(
        `Runstead Postgres schema version ${currentVersion} is newer than supported version ${POSTGRES_CONTROL_PLANE_SCHEMA_VERSION}`
      );
    }

    for (const migration of postgresControlPlaneMigrations(schema)) {
      const checksum = migrationChecksum(migration.sql.join("\n"));
      const existing = applied.rows.find((row) => row.version === migration.version);

      if (existing !== undefined) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Runstead Postgres schema migration ${migration.version} checksum mismatch`
          );
        }

        continue;
      }

      if (migration.version <= currentVersion) {
        throw new Error(
          `Runstead Postgres schema migration ${migration.version} is missing below current version ${currentVersion}`
        );
      }

      for (const statement of migration.sql) {
        await client.query(statement);
      }

      await client.query(
        `
        INSERT INTO ${schema.migrations} (version, name, checksum, applied_at)
        VALUES ($1, $2, $3, $4)
      `,
        [migration.version, migration.name, checksum, new Date().toISOString()]
      );
    }
  });
}

export function postgresControlPlaneMigrationPlan(
  options: { schema?: string } = {}
): PostgresControlPlaneMigrationPlan {
  const schema = postgresSchemaNames(options.schema);
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${schema.schemaIdentifier}`,
    `
      CREATE TABLE IF NOT EXISTS ${schema.migrations} (
        version integer PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `,
    ...postgresControlPlaneMigrations(schema).flatMap((migration) => [
      ...migration.sql,
      `
        INSERT INTO ${schema.migrations} (version, name, checksum, applied_at)
        VALUES (${migration.version}, ${sqlString(migration.name)}, ${sqlString(
          migrationChecksum(migration.sql.join("\n"))
        )}, now())
        ON CONFLICT (version) DO NOTHING
      `
    ])
  ];

  return {
    schema: schema.schema,
    targetVersion: POSTGRES_CONTROL_PLANE_SCHEMA_VERSION,
    statements: statements.map((statement) => statement.trim())
  };
}

export function formatPostgresControlPlaneMigrationSql(
  options: { schema?: string } = {}
): string {
  const plan = postgresControlPlaneMigrationPlan(options);

  return [
    "-- Runstead Postgres control-plane schema",
    `-- schema: ${plan.schema}`,
    `-- target version: ${plan.targetVersion}`,
    "BEGIN;",
    ...plan.statements.map((statement) => `${statement.replace(/;+\s*$/u, "")};`),
    "COMMIT;",
    ""
  ].join("\n\n");
}

export function createPostgresTeamControlPlaneProfile(
  options: PostgresTeamControlPlaneProfileOptions
): RuntimeTeamControlPlaneProfile {
  return {
    scope: {
      kind: "team",
      organizationId: options.organizationId,
      ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId })
    },
    storage: {
      backend: "postgres",
      stateUri: options.stateUri,
      artifactBaseUri: options.artifactBaseUri
    },
    runners: options.runnerIds.map((runnerId) => ({
      runnerId,
      organizationId: options.organizationId,
      ...(options.workspaceId === undefined
        ? {}
        : { workspaceId: options.workspaceId }),
      labels: ["runstead", "team"],
      status: "active" as const
    })),
    leasePolicy: {
      backend: "database",
      fencingTokens: true,
      heartbeatTtlMs: 30_000
    },
    auditSinks: [
      {
        id: "postgres-audit",
        type: "object_store",
        uri: options.auditSinkUri,
        tamperEvidence: "hash_chain",
        retentionDays: 365
      }
    ],
    authz: {
      identityProvider: "oidc",
      rbac: true,
      tenantIsolation: "organization",
      secretsBoundary: "central_secret_store"
    }
  };
}

class PostgresEventStore implements RuntimeEventStore {
  constructor(
    private readonly client: PostgresControlPlaneClient,
    private readonly schema: PostgresSchemaNames
  ) {}

  async append(entries: RuntimeEventAppend[]): Promise<RuntimeEventAppendResult[]> {
    if (entries.length === 0) {
      return [];
    }

    return runPostgresTransaction(this.client, async () => {
      const results: RuntimeEventAppendResult[] = [];

      for (const entry of entries) {
        if (entry.idempotencyKey !== undefined) {
          const existing = await this.idempotentResult(entry.idempotencyKey);

          if (existing !== undefined) {
            results.push(existing);
            continue;
          }
        }

        const currentRevision = await this.aggregateRevision(entry.event);

        if (
          entry.expectedRevision !== undefined &&
          currentRevision !== entry.expectedRevision
        ) {
          throw new PostgresRevisionConflictError(
            entry.event.aggregateType,
            entry.event.aggregateId,
            entry.expectedRevision,
            currentRevision
          );
        }

        await this.client.query(
          `
          INSERT INTO ${this.schema.events} (
            event_id,
            type,
            aggregate_type,
            aggregate_id,
            payload_json,
            created_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        `,
          [
            entry.event.eventId,
            entry.event.type,
            entry.event.aggregateType,
            entry.event.aggregateId,
            JSON.stringify(entry.event.payload),
            entry.event.createdAt
          ]
        );

        if (entry.projection !== undefined) {
          await this.upsertProjection(entry.projection);
        }

        const result = {
          eventId: entry.event.eventId,
          aggregateType: entry.event.aggregateType,
          aggregateId: entry.event.aggregateId,
          revision: currentRevision + 1
        };

        if (entry.idempotencyKey !== undefined) {
          await this.client.query(
            `
            INSERT INTO ${this.schema.idempotency} (
              idempotency_key,
              result_json,
              created_at
            ) VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (idempotency_key) DO NOTHING
          `,
            [entry.idempotencyKey, JSON.stringify(result), entry.event.createdAt]
          );
        }

        results.push(result);
      }

      return results;
    });
  }

  async read(query: RuntimeEventQuery = {}): Promise<RunsteadEvent[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.type !== undefined) {
      params.push(query.type);
      clauses.push(`type = $${params.length}`);
    }

    if (query.aggregateType !== undefined) {
      params.push(query.aggregateType);
      clauses.push(`aggregate_type = $${params.length}`);
    }

    if (query.aggregateId !== undefined) {
      params.push(query.aggregateId);
      clauses.push(`aggregate_id = $${params.length}`);
    }

    if (query.afterRevision !== undefined) {
      params.push(query.afterRevision);
      clauses.push(`id > $${params.length}`);
    }

    const limit = query.limit === undefined ? 1_000 : Math.max(1, query.limit);
    params.push(limit);

    const rows = await this.client.query<PostgresEventRow>(
      `
      SELECT
        id,
        event_id,
        type,
        aggregate_type,
        aggregate_id,
        payload_json,
        created_at
      FROM ${this.schema.events}
      ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
      ORDER BY id ASC
      LIMIT $${params.length}
    `,
      params
    );

    return rows.rows.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: jsonObject(row.payload_json),
      createdAt: dateText(row.created_at)
    }));
  }

  private async idempotentResult(
    idempotencyKey: string
  ): Promise<RuntimeEventAppendResult | undefined> {
    const result = await this.client.query<{ result_json: unknown }>(
      `
      SELECT result_json
      FROM ${this.schema.idempotency}
      WHERE idempotency_key = $1
    `,
      [idempotencyKey]
    );
    const row = result.rows[0];

    return row === undefined ? undefined : runtimeEventAppendResult(row.result_json);
  }

  private async aggregateRevision(event: RunsteadEvent): Promise<number> {
    const revision = await this.client.query<{ revision: number | string }>(
      `
      SELECT COUNT(*)::integer AS revision
      FROM ${this.schema.events}
      WHERE aggregate_type = $1 AND aggregate_id = $2
    `,
      [event.aggregateType, event.aggregateId]
    );

    return numberValue(revision.rows[0]?.revision);
  }

  private async upsertProjection(projection: RuntimeProjectionMutation): Promise<void> {
    const projected = runtimeProjectionRecord(projection);

    await this.client.query(
      `
      INSERT INTO ${this.schema.projections} (
        projection_type,
        aggregate_type,
        aggregate_id,
        payload_json,
        updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (projection_type, aggregate_id) DO UPDATE SET
        aggregate_type = excluded.aggregate_type,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `,
      [
        projected.projectionType,
        projected.aggregateType,
        projected.aggregateId,
        JSON.stringify(projected.value),
        new Date().toISOString()
      ]
    );
  }
}

class PostgresLockManager implements RuntimeLockManager {
  constructor(
    private readonly client: PostgresControlPlaneClient,
    private readonly schema: PostgresSchemaNames
  ) {}

  async acquire(request: RuntimeLockRequest): Promise<RuntimeLockLease> {
    return runPostgresTransaction(this.client, async () => {
      const now = request.now ?? new Date();
      const existing = await this.client.query<PostgresLockRow>(
        `
        SELECT resource, owner, token, fencing_token, expires_at
        FROM ${this.schema.locks}
        WHERE resource = $1
        FOR UPDATE
      `,
        [request.resource]
      );
      const current = existing.rows[0];

      if (
        current !== undefined &&
        new Date(dateText(current.expires_at)).getTime() > now.getTime() &&
        current.owner !== request.owner
      ) {
        throw new PostgresLockUnavailableError(
          request.resource,
          current.owner,
          dateText(current.expires_at)
        );
      }

      const fencingToken = String(numberValue(current?.fencing_token) + 1);
      const token = `lease_${fencingToken}_${randomUUID()}`;
      const expiresAt = new Date(now.getTime() + request.ttlMs).toISOString();

      await this.client.query(
        `
        INSERT INTO ${this.schema.locks} (
          resource,
          owner,
          token,
          fencing_token,
          expires_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (resource) DO UPDATE SET
          owner = excluded.owner,
          token = excluded.token,
          fencing_token = excluded.fencing_token,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `,
        [
          request.resource,
          request.owner,
          token,
          Number(fencingToken),
          expiresAt,
          now.toISOString()
        ]
      );

      return this.lease({
        resource: request.resource,
        owner: request.owner,
        token,
        fencingToken,
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
        await this.client.query(
          `
          UPDATE ${this.schema.locks}
          SET expires_at = $3, updated_at = $3
          WHERE resource = $1 AND token = $2
        `,
          [input.resource, input.token, new Date(0).toISOString()]
        );
      },
      renew: async (ttlMs) => {
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        const updated = await this.client.query<PostgresLockRow>(
          `
          UPDATE ${this.schema.locks}
          SET expires_at = $3, updated_at = $4
          WHERE resource = $1 AND token = $2
          RETURNING resource, owner, token, fencing_token, expires_at
        `,
          [input.resource, input.token, expiresAt, new Date().toISOString()]
        );
        const row = updated.rows[0];

        if (row === undefined) {
          throw new Error(`Cannot renew expired or superseded lease ${input.resource}`);
        }

        return this.lease({
          resource: row.resource,
          owner: row.owner,
          token: row.token,
          fencingToken: String(row.fencing_token),
          expiresAt: dateText(row.expires_at)
        });
      }
    };
  }
}

class PostgresArtifactStore implements RuntimeArtifactStore {
  constructor(
    private readonly client: PostgresControlPlaneClient,
    private readonly schema: PostgresSchemaNames,
    private readonly artifactBaseUri: string
  ) {}

  async write(artifact: RuntimeArtifactWrite): Promise<RuntimeArtifactRecord> {
    const contents = artifactBytes(artifact.contents);
    const sha256 = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
    const uri = `${this.artifactBaseUri.replace(/\/+$/u, "")}/${artifact.path.replace(/^\/+/u, "")}`;

    await this.client.query(
      `
      INSERT INTO ${this.schema.artifacts} (
        uri,
        path,
        content_type,
        sha256,
        metadata_json,
        contents,
        created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (uri) DO UPDATE SET
        content_type = excluded.content_type,
        sha256 = excluded.sha256,
        metadata_json = excluded.metadata_json,
        contents = excluded.contents
    `,
      [
        uri,
        artifact.path,
        artifact.contentType,
        sha256,
        JSON.stringify(artifact.metadata ?? {}),
        Buffer.from(contents),
        new Date().toISOString()
      ]
    );

    return {
      uri,
      contentType: artifact.contentType,
      sha256,
      ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata })
    };
  }

  async read(uri: string): Promise<Uint8Array> {
    const result = await this.client.query<{ contents: unknown }>(
      `
      SELECT contents
      FROM ${this.schema.artifacts}
      WHERE uri = $1
    `,
      [uri]
    );
    const contents = result.rows[0]?.contents;

    if (contents === undefined) {
      throw new Error(`Runstead artifact not found: ${uri}`);
    }

    return artifactBytes(contents);
  }
}

class PostgresRunnerRegistry implements RuntimeRunnerRegistry {
  constructor(
    private readonly client: PostgresControlPlaneClient,
    private readonly schema: PostgresSchemaNames
  ) {}

  async heartbeat(
    input: RuntimeRunnerHeartbeatInput
  ): Promise<RuntimeRunnerRegistration> {
    const now = input.now ?? new Date();
    const status = input.status ?? "active";
    const labels = input.labels ?? [];
    const result = await this.client.query<PostgresRunnerRow>(
      `
      INSERT INTO ${this.schema.runners} (
        runner_id,
        organization_id,
        workspace_id,
        labels_json,
        status,
        last_seen_at,
        updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)
      ON CONFLICT (runner_id) DO UPDATE SET
        organization_id = excluded.organization_id,
        workspace_id = excluded.workspace_id,
        labels_json = excluded.labels_json,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
      RETURNING runner_id, organization_id, workspace_id, labels_json, status, last_seen_at
    `,
      [
        input.runnerId,
        input.organizationId ?? null,
        input.workspaceId ?? null,
        JSON.stringify(labels),
        status,
        now.toISOString()
      ]
    );

    return rowToRunnerRegistration(result.rows[0], {
      runnerId: input.runnerId,
      ...(input.organizationId === undefined
        ? {}
        : { organizationId: input.organizationId }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      labels,
      status,
      lastSeenAt: now.toISOString()
    });
  }

  async list(query: RuntimeRunnerListQuery = {}): Promise<RuntimeRunnerRegistration[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.organizationId !== undefined) {
      params.push(query.organizationId);
      clauses.push(`organization_id = $${params.length}`);
    }

    if (query.workspaceId !== undefined) {
      params.push(query.workspaceId);
      clauses.push(`workspace_id = $${params.length}`);
    }

    if (query.status !== undefined) {
      params.push(query.status);
      clauses.push(`status = $${params.length}`);
    }

    const result = await this.client.query<PostgresRunnerRow>(
      `
      SELECT runner_id, organization_id, workspace_id, labels_json, status, last_seen_at
      FROM ${this.schema.runners}
      ${clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`}
      ORDER BY last_seen_at DESC, runner_id ASC
    `,
      params
    );

    return result.rows.map((row) => rowToRunnerRegistration(row));
  }
}

export class PostgresRevisionConflictError extends Error {
  constructor(
    aggregateType: string,
    aggregateId: string,
    expected: number,
    actual: number
  ) {
    super(
      `Revision conflict for ${aggregateType}:${aggregateId}: expected ${expected}, got ${actual}`
    );
    this.name = "PostgresRevisionConflictError";
  }
}

export class PostgresLockUnavailableError extends Error {
  constructor(resource: string, owner: string, expiresAt: string) {
    super(`Postgres lock ${resource} is held by ${owner} until ${expiresAt}`);
    this.name = "PostgresLockUnavailableError";
  }
}

interface PostgresEventRow extends PostgresRow {
  id: number | string;
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: unknown;
  created_at: string | Date;
}

interface PostgresLockRow extends PostgresRow {
  resource: string;
  owner: string;
  token: string;
  fencing_token: number | string;
  expires_at: string | Date;
}

interface PostgresRunnerRow extends PostgresRow {
  runner_id: string;
  organization_id?: string | null;
  workspace_id?: string | null;
  labels_json: unknown;
  status: RuntimeRunnerRegistration["status"];
  last_seen_at: string | Date;
}

function postgresControlPlaneMigrations(
  schema: PostgresSchemaNames
): PostgresMigration[] {
  return [
    {
      version: 1,
      name: "team_control_plane_backend",
      sql: [
        `
        CREATE TABLE IF NOT EXISTS ${schema.events} (
          id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          event_id text UNIQUE NOT NULL,
          type text NOT NULL,
          aggregate_type text NOT NULL,
          aggregate_id text NOT NULL,
          payload_json jsonb NOT NULL,
          created_at timestamptz NOT NULL
        )
      `,
        `
        CREATE TABLE IF NOT EXISTS ${schema.projections} (
          projection_type text NOT NULL,
          aggregate_type text NOT NULL,
          aggregate_id text NOT NULL,
          payload_json jsonb NOT NULL,
          updated_at timestamptz NOT NULL,
          PRIMARY KEY (projection_type, aggregate_id)
        )
      `,
        `
        CREATE TABLE IF NOT EXISTS ${schema.idempotency} (
          idempotency_key text PRIMARY KEY,
          result_json jsonb NOT NULL,
          created_at timestamptz NOT NULL
        )
      `,
        `
        CREATE TABLE IF NOT EXISTS ${schema.locks} (
          resource text PRIMARY KEY,
          owner text NOT NULL,
          token text NOT NULL,
          fencing_token bigint NOT NULL,
          expires_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        )
      `,
        `
        CREATE TABLE IF NOT EXISTS ${schema.artifacts} (
          uri text PRIMARY KEY,
          path text NOT NULL,
          content_type text NOT NULL,
          sha256 text NOT NULL,
          metadata_json jsonb NOT NULL,
          contents bytea NOT NULL,
          created_at timestamptz NOT NULL
        )
      `,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_events_type_created_id")} ON ${schema.events} (type, created_at DESC, id DESC)`,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_events_aggregate_id")} ON ${schema.events} (aggregate_type, aggregate_id, id ASC)`,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_projections_type_updated")} ON ${schema.projections} (projection_type, updated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_locks_expires_at")} ON ${schema.locks} (expires_at ASC)`
      ]
    },
    {
      version: 2,
      name: "team_runner_registry",
      sql: [
        `
        CREATE TABLE IF NOT EXISTS ${schema.runners} (
          runner_id text PRIMARY KEY,
          organization_id text,
          workspace_id text,
          labels_json jsonb NOT NULL,
          status text NOT NULL,
          last_seen_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        )
      `,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_runners_org_status_seen")} ON ${schema.runners} (organization_id, status, last_seen_at DESC)`,
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier("idx_pg_runners_workspace_status_seen")} ON ${schema.runners} (workspace_id, status, last_seen_at DESC)`
      ]
    }
  ];
}

async function runPostgresTransaction<T>(
  client: PostgresControlPlaneClient,
  operation: () => Promise<T>
): Promise<T> {
  await client.query("BEGIN");

  try {
    const result = await operation();

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function postgresSchemaNames(schema = "runstead"): PostgresSchemaNames {
  const schemaIdentifier = quoteIdentifier(schema);
  const table = (name: string) => `${schemaIdentifier}.${quoteIdentifier(name)}`;

  return {
    schema,
    schemaIdentifier,
    migrations: table("schema_migrations"),
    events: table("events"),
    projections: table("runtime_projections"),
    idempotency: table("runtime_event_idempotency"),
    locks: table("runtime_locks"),
    artifacts: table("runtime_artifacts"),
    runners: table("runtime_runners")
  };
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

function rowToRunnerRegistration(
  row: PostgresRunnerRow | undefined,
  fallback?: RuntimeRunnerRegistration
): RuntimeRunnerRegistration {
  if (row === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error("Postgres runner heartbeat did not return a runner row");
  }

  return {
    runnerId: row.runner_id,
    ...(row.organization_id === undefined || row.organization_id === null
      ? {}
      : { organizationId: row.organization_id }),
    ...(row.workspace_id === undefined || row.workspace_id === null
      ? {}
      : { workspaceId: row.workspace_id }),
    labels: stringArray(row.labels_json),
    status: parseRunnerStatus(row.status),
    lastSeenAt: dateText(row.last_seen_at)
  };
}

function parseRunnerStatus(value: string): RuntimeRunnerRegistration["status"] {
  if (value === "active" || value === "draining" || value === "offline") {
    return value;
  }

  return "offline";
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return stringArray(JSON.parse(value) as unknown);
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function jsonObject(value: unknown): JsonObject {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;

    return jsonObject(parsed);
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return {};
}

function stringProperty(value: JsonObject, key: string): string {
  const parsed = value[key];

  if (typeof parsed !== "string" || parsed.length === 0) {
    throw new Error(`Postgres control-plane row is missing ${key}`);
  }

  return parsed;
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function dateText(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
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

  throw new Error("Unsupported Postgres artifact byte payload");
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid Postgres identifier: ${value}`);
  }

  return `"${value}"`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
