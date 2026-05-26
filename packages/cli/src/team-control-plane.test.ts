import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initRunstead } from "./init.js";
import {
  bootstrapTeamControlPlane,
  checkTeamControlPlane,
  formatTeamControlPlaneCheck,
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
