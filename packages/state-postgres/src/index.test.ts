import { describe, expect, it } from "vitest";

import { assessTeamControlPlaneReadiness } from "@runstead/runtime";

import {
  createPostgresControlPlaneBackend,
  createPostgresTeamControlPlaneProfile,
  migratePostgresControlPlane,
  PostgresLockUnavailableError,
  PostgresRevisionConflictError,
  type PostgresControlPlaneClient,
  type PostgresQueryResult,
  type PostgresRow
} from "./index.js";

describe("@runstead/state-postgres", () => {
  it("migrates shared control-plane tables, locks, artifacts, and indexes", async () => {
    const client = new FakePostgresClient();

    await migratePostgresControlPlane(client, { schema: "runstead_team" });

    const sql = client.queries.join("\n");

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "runstead_team"');
    expect(sql).toContain('"runstead_team"."events"');
    expect(sql).toContain('"runstead_team"."runtime_projections"');
    expect(sql).toContain('"runstead_team"."runtime_locks"');
    expect(sql).toContain('"runstead_team"."runtime_artifacts"');
    expect(sql).toContain("idx_pg_events_aggregate_id");
    expect(client.queries[0]).toBe("BEGIN");
    expect(client.queries.at(-1)).toBe("COMMIT");
  });

  it("appends events and projections transactionally with idempotency", async () => {
    const client = new FakePostgresClient();
    const backend = createPostgresControlPlaneBackend({
      client,
      stateUri: "postgres://runstead/state"
    });
    const event = {
      eventId: "evt_pg_1",
      type: "task.updated",
      aggregateType: "task",
      aggregateId: "task_pg_1",
      payload: {
        status: "queued"
      },
      createdAt: "2026-05-24T00:00:00.000Z"
    };

    const [first] = await backend.events.append([
      {
        event,
        expectedRevision: 0,
        idempotencyKey: "task_pg_1:update",
        projection: {
          type: "task",
          value: {
            id: "task_pg_1",
            goalId: "goal_pg_1",
            domain: "repo-maintenance",
            type: "local_agent_task",
            status: "queued",
            priority: "medium",
            attempt: 0,
            maxAttempts: 1,
            input: {},
            verifiers: [],
            createdAt: "2026-05-24T00:00:00.000Z",
            updatedAt: "2026-05-24T00:00:00.000Z"
          }
        }
      }
    ]);
    const [second] = await backend.events.append([
      {
        event,
        expectedRevision: 0,
        idempotencyKey: "task_pg_1:update"
      }
    ]);
    const events = await backend.events.read({
      aggregateType: "task",
      aggregateId: "task_pg_1"
    });

    expect(first).toEqual({
      eventId: "evt_pg_1",
      aggregateType: "task",
      aggregateId: "task_pg_1",
      revision: 1
    });
    expect(second).toEqual(first);
    expect(events).toEqual([event]);
    expect(client.events).toHaveLength(1);
    expect(client.projections[0]).toMatchObject({
      projectionType: "task",
      aggregateId: "task_pg_1"
    });
    await expect(
      backend.events.append([
        {
          event: {
            ...event,
            eventId: "evt_pg_2"
          },
          expectedRevision: 0
        }
      ])
    ).rejects.toBeInstanceOf(PostgresRevisionConflictError);
  });

  it("provides fenced database leases and database-backed artifacts", async () => {
    const client = new FakePostgresClient();
    const backend = createPostgresControlPlaneBackend({
      client,
      stateUri: "postgres://runstead/state",
      artifactBaseUri: "s3://runstead-artifacts"
    });
    const lease = await backend.locks.acquire({
      resource: "workspace:todo",
      owner: "runner:one",
      ttlMs: 30_000,
      now: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(lease.fencingToken).toBe("1");
    await expect(
      backend.locks.acquire({
        resource: "workspace:todo",
        owner: "runner:two",
        ttlMs: 30_000,
        now: new Date("2026-05-24T00:00:01.000Z")
      })
    ).rejects.toBeInstanceOf(PostgresLockUnavailableError);

    const artifact = await backend.artifacts.write({
      path: "reports/launch.json",
      contentType: "application/json",
      contents: "{\"status\":\"ready\"}",
      metadata: {
        target: "local"
      }
    });
    const contents = await backend.artifacts.read(artifact.uri);

    expect(artifact).toMatchObject({
      uri: "s3://runstead-artifacts/reports/launch.json",
      contentType: "application/json"
    });
    expect(artifact.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Buffer.from(contents).toString("utf8")).toBe("{\"status\":\"ready\"}");

    await lease.release();
    const nextLease = await backend.locks.acquire({
      resource: "workspace:todo",
      owner: "runner:two",
      ttlMs: 30_000,
      now: new Date("2026-05-24T00:00:02.000Z")
    });

    expect(nextLease.fencingToken).toBe("2");
  });

  it("creates a team readiness profile that satisfies shared backend gates", () => {
    const profile = createPostgresTeamControlPlaneProfile({
      organizationId: "org_123",
      workspaceId: "workspace_todo",
      stateUri: "postgres://runstead-control-plane/state",
      artifactBaseUri: "s3://runstead/evidence",
      runnerIds: ["runner_a", "runner_b"],
      auditSinkUri: "s3://runstead/audit"
    });
    const assessment = assessTeamControlPlaneReadiness(profile);

    expect(profile.storage.backend).toBe("postgres");
    expect(profile.leasePolicy).toMatchObject({
      backend: "database",
      fencingTokens: true
    });
    expect(assessment.passed).toBe(true);
    expect(assessment.blockers).toEqual([]);
  });
});

interface FakeEventRow extends PostgresRow {
  id: number;
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: unknown;
  created_at: string;
}

interface FakeProjection {
  projectionType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
}

interface FakeLock {
  [key: string]: unknown;
  resource: string;
  owner: string;
  token: string;
  fencing_token: number;
  expires_at: string;
}

class FakePostgresClient implements PostgresControlPlaneClient {
  readonly queries: string[] = [];
  readonly events: FakeEventRow[] = [];
  readonly projections: FakeProjection[] = [];
  readonly idempotency = new Map<string, unknown>();
  readonly locks = new Map<string, FakeLock>();
  readonly artifacts = new Map<string, Uint8Array>();

  async query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    await Promise.resolve();

    const normalized = sql.replace(/\s+/gu, " ").trim();

    this.queries.push(normalized);

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return rows<Row>();
    }

    if (normalized.includes("FROM") && normalized.includes("schema_migrations")) {
      return rows<Row>();
    }

    if (normalized.includes("SELECT result_json")) {
      const found = this.idempotency.get(String(params[0]));

      return rows<Row>(found === undefined ? [] : [{ result_json: found }]);
    }

    if (normalized.includes("SELECT COUNT(*)::integer AS revision")) {
      const aggregateType = String(params[0]);
      const aggregateId = String(params[1]);
      const revision = this.events.filter(
        (event) =>
          event.aggregate_type === aggregateType && event.aggregate_id === aggregateId
      ).length;

      return rows<Row>([{ revision }]);
    }

    if (normalized.includes("INSERT INTO") && normalized.includes('"events"')) {
      this.events.push({
        id: this.events.length + 1,
        event_id: String(params[0]),
        type: String(params[1]),
        aggregate_type: String(params[2]),
        aggregate_id: String(params[3]),
        payload_json: JSON.parse(String(params[4])) as unknown,
        created_at: String(params[5])
      });

      return rows<Row>();
    }

    if (
      normalized.includes("INSERT INTO") &&
      normalized.includes('"runtime_projections"')
    ) {
      this.projections.push({
        projectionType: String(params[0]),
        aggregateType: String(params[1]),
        aggregateId: String(params[2]),
        payload: JSON.parse(String(params[3])) as unknown
      });

      return rows<Row>();
    }

    if (
      normalized.includes("INSERT INTO") &&
      normalized.includes('"runtime_event_idempotency"')
    ) {
      this.idempotency.set(String(params[0]), JSON.parse(String(params[1])));

      return rows<Row>();
    }

    if (normalized.includes("FROM") && normalized.includes('"events"')) {
      const aggregateType = params.includes("task") ? "task" : undefined;
      const aggregateId = params.includes("task_pg_1") ? "task_pg_1" : undefined;

      return rows<Row>(
        this.events.filter(
          (event) =>
            (aggregateType === undefined || event.aggregate_type === aggregateType) &&
            (aggregateId === undefined || event.aggregate_id === aggregateId)
        )
      );
    }

    if (normalized.includes("FROM") && normalized.includes('"runtime_locks"')) {
      const lock = this.locks.get(String(params[0]));

      return rows<Row>(lock === undefined ? [] : [lock]);
    }

    if (
      normalized.includes("INSERT INTO") &&
      normalized.includes('"runtime_locks"')
    ) {
      this.locks.set(String(params[0]), {
        resource: String(params[0]),
        owner: String(params[1]),
        token: String(params[2]),
        fencing_token: Number(params[3]),
        expires_at: String(params[4])
      });

      return rows<Row>();
    }

    if (
      normalized.includes("UPDATE") &&
      normalized.includes('"runtime_locks"') &&
      normalized.includes("SET expires_at = $3")
    ) {
      const existing = this.locks.get(String(params[0]));

      if (existing?.token === String(params[1])) {
        this.locks.set(String(params[0]), {
          ...existing,
          expires_at: String(params[2])
        });
      }

      return rows<Row>();
    }

    if (
      normalized.includes("INSERT INTO") &&
      normalized.includes('"runtime_artifacts"')
    ) {
      this.artifacts.set(String(params[0]), artifactBytes(params[5]));

      return rows<Row>();
    }

    if (normalized.includes("SELECT contents") && normalized.includes('"runtime_artifacts"')) {
      const contents = this.artifacts.get(String(params[0]));

      return rows<Row>(contents === undefined ? [] : [{ contents }]);
    }

    return rows<Row>();
  }
}

function rows<Row extends PostgresRow>(values: PostgresRow[] = []): PostgresQueryResult<Row> {
  return {
    rows: values as Row[],
    rowCount: values.length
  };
}

function artifactBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }

  throw new Error("expected fake artifact bytes");
}
