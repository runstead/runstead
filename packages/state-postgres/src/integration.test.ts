import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runRuntimeControlPlaneBackendConformance } from "@runstead/testkit";

import {
  createPostgresControlPlaneBackend,
  migratePostgresControlPlane,
  PsqlPostgresControlPlaneClient
} from "./index.js";

const postgresUrl = process.env.RUNSTEAD_PG_TEST_URL?.trim();
const describePostgres =
  postgresUrl === undefined || postgresUrl.length === 0 ? describe.skip : describe;

describePostgres("@runstead/state-postgres integration", () => {
  it("passes control-plane conformance against a real Postgres service", async () => {
    const schema = `runstead_it_${randomUUID().replaceAll("-", "_")}`;
    const client = await PsqlPostgresControlPlaneClient.connect(postgresUrl ?? "");

    try {
      await migratePostgresControlPlane(client, { schema });

      const result = await runRuntimeControlPlaneBackendConformance({
        name: "postgres-real",
        create: () =>
          Promise.resolve({
            backend: createPostgresControlPlaneBackend({
              client,
              schema,
              stateUri: postgresUrl ?? "postgres://runstead/state",
              artifactBaseUri: "s3://runstead-it-artifacts"
            })
          })
      });

      expect(result).toEqual({
        name: "postgres-real",
        checks: [
          "event_append_projection",
          "idempotency_key",
          "expected_revision_conflict",
          "lock_renew_release",
          "artifact_hash_read",
          "runner_heartbeat_registry"
        ]
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await client.end();
    }
  }, 30_000);
});

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid Postgres identifier: ${value}`);
  }

  return `"${value}"`;
}
