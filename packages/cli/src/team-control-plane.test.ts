import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  PostgresControlPlaneClient,
  PostgresQueryResult,
  PostgresRow
} from "@runstead/state-postgres";

import { initRunstead } from "./init.js";
import {
  bootstrapTeamControlPlane,
  checkTeamControlPlane,
  formatTeamControlPlaneCheck,
  formatTeamControlPlaneRunnerHeartbeat,
  formatTeamControlPlaneRunnerList,
  listTeamControlPlaneRunners,
  recordTeamControlPlaneRunnerHeartbeat,
  teamControlPlaneMigrationSql
} from "./team-control-plane.js";

describe("team control plane checks", () => {
  it("blocks team readiness until Postgres backend settings are explicit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-cp-missing-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await checkTeamControlPlane({
        cwd: workspace,
        env: {}
      });

      expect(result.passed).toBe(false);
      expect(result.backend).toBe("sqlite");
      expect(result.assertions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "backend-selected",
            status: "fail"
          }),
          expect.objectContaining({
            id: "postgres-connection",
            status: "fail"
          })
        ])
      );
      expect(result.nextActions).toEqual(
        expect.arrayContaining(["export RUNSTEAD_RUNTIME_BACKEND=postgres"])
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("passes when Postgres team backend, runners, audit, RBAC, and secrets are configured", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-cp-ready-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await checkTeamControlPlane({
        cwd: workspace,
        now: new Date("2026-05-24T00:00:15.000Z"),
        env: {
          RUNSTEAD_RUNTIME_BACKEND: "postgres",
          RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
          RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
          RUNSTEAD_TEAM_ORG_ID: "org_123",
          RUNSTEAD_RUNNER_ID: "runner_1,runner_2",
          RUNSTEAD_RUNNER_LAST_SEEN_AT:
            "runner_1=2026-05-24T00:00:00.000Z,runner_2=2026-05-24T00:00:01.000Z",
          RUNSTEAD_AUDIT_SINK_URI: "s3://runstead/audit",
          RUNSTEAD_TEAM_IDENTITY_PROVIDER: "oidc",
          RUNSTEAD_TEAM_TENANT_ISOLATION: "organization",
          RUNSTEAD_TEAM_SECRETS_BOUNDARY: "central_secret_store",
          RUNSTEAD_TEAM_RBAC: "true"
        }
      });

      expect(result.passed).toBe(true);
      expect(result.backend).toBe("postgres");
      expect(result.assertions.every((assertion) => assertion.status === "pass")).toBe(
        true
      );
      expect(formatTeamControlPlaneCheck(result)).toContain("Status: ready");
      expect(formatTeamControlPlaneCheck(result)).toContain(
        "2 fresh runner heartbeat(s) recorded"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("blocks team readiness when runner heartbeats are not fresh", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-cp-stale-"));

    try {
      await initRunstead({ cwd: workspace });

      const result = await checkTeamControlPlane({
        cwd: workspace,
        now: new Date("2026-05-24T00:01:00.000Z"),
        env: {
          RUNSTEAD_RUNTIME_BACKEND: "postgres",
          RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
          RUNSTEAD_ARTIFACT_BASE_URI: "s3://runstead/evidence",
          RUNSTEAD_TEAM_ORG_ID: "org_123",
          RUNSTEAD_RUNNER_ID: "runner_1",
          RUNSTEAD_RUNNER_LAST_SEEN_AT: "2026-05-24T00:00:00.000Z",
          RUNSTEAD_AUDIT_SINK_URI: "s3://runstead/audit"
        }
      });

      expect(result.passed).toBe(false);
      expect(result.assertions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "runner-heartbeat",
            status: "fail"
          })
        ])
      );
      expect(result.setupBlockers).toContain(
        "at least one fresh active runner heartbeat is required"
      );
      expect(result.nextActions).toContain(
        "export RUNSTEAD_RUNNER_LAST_SEEN_AT with fresh runner heartbeat timestamps"
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("records and lists live Postgres runner heartbeats", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-cp-runner-"));
    const client = new FakeTeamPostgresClient();

    try {
      await initRunstead({ cwd: workspace });

      const heartbeat = await recordTeamControlPlaneRunnerHeartbeat({
        cwd: workspace,
        now: new Date("2026-05-24T00:00:00.000Z"),
        migrate: true,
        env: {
          RUNSTEAD_RUNTIME_BACKEND: "postgres",
          RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
          RUNSTEAD_TEAM_ORG_ID: "org_123",
          RUNSTEAD_TEAM_WORKSPACE_ID: "workspace_123",
          RUNSTEAD_RUNNER_ID: "runner_1"
        },
        labels: ["runstead", "codex_direct"],
        postgresClientFactory: () => Promise.resolve(client)
      });
      const list = await listTeamControlPlaneRunners({
        cwd: workspace,
        env: {
          RUNSTEAD_RUNTIME_BACKEND: "postgres",
          RUNSTEAD_POSTGRES_URL: "postgres://runstead/state",
          RUNSTEAD_TEAM_ORG_ID: "org_123",
          RUNSTEAD_TEAM_WORKSPACE_ID: "workspace_123"
        },
        postgresClientFactory: () => Promise.resolve(client)
      });

      expect(heartbeat).toMatchObject({
        backend: "postgres",
        schema: "runstead",
        migrated: true,
        runner: {
          runnerId: "runner_1",
          organizationId: "org_123",
          workspaceId: "workspace_123",
          labels: ["runstead", "codex_direct"],
          status: "active",
          lastSeenAt: "2026-05-24T00:00:00.000Z"
        }
      });
      expect(list.runners).toEqual([heartbeat.runner]);
      expect(formatTeamControlPlaneRunnerHeartbeat(heartbeat)).toContain(
        "Runner: runner_1"
      );
      expect(formatTeamControlPlaneRunnerList(list)).toContain("Count: 1");
      expect(client.queries.join("\n")).toContain('"runtime_runners"');
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("writes a reusable team control-plane env template", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-team-cp-bootstrap-"));

    try {
      await initRunstead({ cwd: workspace });

      const first = await bootstrapTeamControlPlane({ cwd: workspace });
      const second = await bootstrapTeamControlPlane({ cwd: workspace });
      const template = await readFile(first.path, "utf8");

      expect(first.overwritten).toBe(false);
      expect(second.overwritten).toBe(false);
      expect(first.path).toBe(
        join(workspace, ".runstead", "team-control-plane.env.example")
      );
      expect(first.checkCommand).toContain("team control-plane check");
      expect(template).toContain("RUNSTEAD_RUNTIME_BACKEND=postgres");
      expect(template).toContain("RUNSTEAD_RUNNER_LAST_SEEN_AT=");
      expect(template).toContain("RUNSTEAD_TEAM_SECRETS_BOUNDARY=central_secret_store");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("prints Postgres migration SQL for team backend bootstrap", () => {
    const sql = teamControlPlaneMigrationSql({ schema: "runstead_team" });

    expect(sql).toContain("-- Runstead Postgres control-plane schema");
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "runstead_team"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "runstead_team"."events"');
    expect(sql).toContain('INSERT INTO "runstead_team"."schema_migrations"');
    expect(sql).toContain("COMMIT;");
  });
});

interface FakeRunnerRow extends PostgresRow {
  runner_id: string;
  organization_id?: string | null;
  workspace_id?: string | null;
  labels_json: unknown;
  status: string;
  last_seen_at: string;
}

class FakeTeamPostgresClient implements PostgresControlPlaneClient {
  readonly queries: string[] = [];
  readonly runners = new Map<string, FakeRunnerRow>();

  async query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    await Promise.resolve();

    const normalized = sql.replace(/\s+/gu, " ").trim();

    this.queries.push(normalized);

    if (normalized.includes("FROM") && normalized.includes("schema_migrations")) {
      return rows<Row>();
    }

    if (
      normalized.includes("INSERT INTO") &&
      normalized.includes('"runtime_runners"')
    ) {
      const runner: FakeRunnerRow = {
        runner_id: String(params[0]),
        organization_id: optionalString(params[1]),
        workspace_id: optionalString(params[2]),
        labels_json: JSON.parse(String(params[3])) as unknown,
        status: String(params[4]),
        last_seen_at: String(params[5])
      };

      this.runners.set(runner.runner_id, runner);

      return rows<Row>([runner]);
    }

    if (normalized.includes("FROM") && normalized.includes('"runtime_runners"')) {
      const organizationId = sqlParameter(normalized, params, "organization_id");
      const workspaceId = sqlParameter(normalized, params, "workspace_id");
      const status = sqlParameter(normalized, params, "status");
      const found = [...this.runners.values()].filter(
        (runner) =>
          (organizationId === undefined || runner.organization_id === organizationId) &&
          (workspaceId === undefined || runner.workspace_id === workspaceId) &&
          (status === undefined || runner.status === status)
      );

      return rows<Row>(found);
    }

    return rows<Row>();
  }
}

function rows<Row extends PostgresRow>(
  values: PostgresRow[] = []
): PostgresQueryResult<Row> {
  return {
    rows: values as Row[],
    rowCount: values.length
  };
}

function sqlParameter(
  sql: string,
  params: readonly unknown[],
  column: string
): string | undefined {
  const match = new RegExp(`${column} = \\$(\\d+)`, "u").exec(sql);
  const index = match?.[1] === undefined ? undefined : Number(match[1]) - 1;
  const value = index === undefined ? undefined : params[index];

  return typeof value === "string" ? value : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
