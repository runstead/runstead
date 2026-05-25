import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runRuntimeControlPlaneBackendConformance } from "@runstead/testkit";

import {
  createPostgresControlPlaneBackend,
  migratePostgresControlPlane,
  type PostgresControlPlaneClient,
  type PostgresQueryResult,
  type PostgresRow
} from "./index.js";

const postgresUrl = process.env.RUNSTEAD_PG_TEST_URL?.trim();
const describePostgres =
  postgresUrl === undefined || postgresUrl.length === 0 ? describe.skip : describe;

describePostgres("@runstead/state-postgres integration", () => {
  it("passes control-plane conformance against a real Postgres service", async () => {
    const schema = `runstead_it_${randomUUID().replaceAll("-", "_")}`;
    const client = await PsqlControlPlaneClient.connect(postgresUrl ?? "");

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
          "artifact_hash_read"
        ]
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await client.end();
    }
  }, 30_000);
});

class PsqlControlPlaneClient implements PostgresControlPlaneClient {
  private pending:
    | {
        begin: string;
        end: string;
        returningRows: boolean;
        lines: string[];
        resolve: (result: PostgresQueryResult) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  private queue = Promise.resolve();
  private stderr = "";
  private currentLine = "";

  private constructor(private readonly process: ChildProcessWithoutNullStreams) {
    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });
    process.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    process.on("exit", (code, signal) => {
      const error = new Error(
        `psql exited before query completed: code=${code ?? "none"} signal=${signal ?? "none"} stderr=${this.stderr.trim()}`
      );

      this.pending?.reject(error);
      this.pending = undefined;
    });
    process.on("error", (error) => {
      this.pending?.reject(error);
      this.pending = undefined;
    });
  }

  static async connect(url: string): Promise<PsqlControlPlaneClient> {
    const child = spawn(
      "psql",
      [
        "--no-psqlrc",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
        url
      ],
      {
        stdio: "pipe"
      }
    );
    const client = new PsqlControlPlaneClient(child);

    await client.query("SELECT 1 AS connected");

    return client;
  }

  async query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    const run = (): Promise<PostgresQueryResult<Row>> =>
      this.queryNow<Row>(sql, params);
    const next = this.queue.then(run, run);

    this.queue = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  async end(): Promise<void> {
    await this.queue;
    await new Promise<void>((resolve, reject) => {
      this.process.once("exit", () => {
        resolve();
      });
      this.process.once("error", reject);
      this.process.stdin.end("\\q\n");
    });
  }

  private queryNow<Row extends PostgresRow>(
    sql: string,
    params: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    if (this.pending !== undefined) {
      return Promise.reject(new Error("psql client already has a pending query"));
    }

    const id = randomUUID().replaceAll("-", "_");
    const begin = `__RUNSTEAD_BEGIN_${id}__`;
    const end = `__RUNSTEAD_END_${id}__`;
    const prepared = preparePsqlStatement(sql, params);

    return new Promise((resolve, reject) => {
      this.pending = {
        begin,
        end,
        returningRows: prepared.returningRows,
        lines: [],
        resolve: resolve as (result: PostgresQueryResult) => void,
        reject
      };
      this.process.stdin.write(`\\echo ${begin}\n${prepared.sql}\n\\echo ${end}\n`);
    });
  }

  private handleStdout(chunk: string): void {
    this.currentLine += chunk;
    let newline = this.currentLine.indexOf("\n");

    while (newline >= 0) {
      const line = this.currentLine.slice(0, newline).trimEnd();

      this.currentLine = this.currentLine.slice(newline + 1);
      this.handleStdoutLine(line);
      newline = this.currentLine.indexOf("\n");
    }
  }

  private handleStdoutLine(line: string): void {
    const pending = this.pending;

    if (pending === undefined) {
      return;
    }

    if (line === pending.begin) {
      pending.lines = [];
      return;
    }

    if (line === pending.end) {
      this.pending = undefined;
      pending.resolve(parsePsqlResult(pending.lines, pending.returningRows));
      return;
    }

    pending.lines.push(line);
  }
}

function preparePsqlStatement(
  sql: string,
  params: readonly unknown[]
): { sql: string; returningRows: boolean } {
  const substituted = stripTrailingSemicolon(sql).replace(/\$(\d+)/gu, (_match, id) =>
    sqlLiteral(params[Number(id) - 1])
  );
  const returningRows = psqlStatementReturnsRows(substituted);

  if (!returningRows) {
    return { sql: `${substituted};`, returningRows };
  }

  return {
    sql: [
      "WITH runstead_query AS (",
      substituted,
      ")",
      "SELECT COALESCE(json_agg(row_to_json(runstead_query)), '[]'::json)",
      "FROM runstead_query;"
    ].join("\n"),
    returningRows
  };
}

function psqlStatementReturnsRows(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();

  return normalized.startsWith("SELECT") || /\bRETURNING\b/u.test(normalized);
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+$/u, "");
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `decode('${Buffer.from(value).toString("hex")}', 'hex')`;
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replaceAll("'", "''")}'`;
  }

  const json = JSON.stringify(value);

  if (json === undefined) {
    throw new Error("Unsupported Postgres test parameter");
  }

  return `'${json.replaceAll("'", "''")}'`;
}

function parsePsqlResult(lines: string[], returningRows: boolean): PostgresQueryResult {
  if (!returningRows) {
    return {
      rows: [],
      rowCount: null
    };
  }

  const payload = lines.join("\n").trim();
  const rows = JSON.parse(payload.length === 0 ? "[]" : payload) as PostgresRow[];

  return {
    rows: rows.map(decodePsqlRow),
    rowCount: rows.length
  };
}

function decodePsqlRow(row: PostgresRow): PostgresRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key === "contents" && typeof value === "string" && value.startsWith("\\x")
        ? Buffer.from(value.slice(2), "hex")
        : value
    ])
  );
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid Postgres identifier: ${value}`);
  }

  return `"${value}"`;
}
