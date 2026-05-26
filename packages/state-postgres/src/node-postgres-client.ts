import type {
  PostgresControlPlaneClient,
  PostgresQueryResult,
  PostgresRow
} from "./index.js";

export interface NodePostgresDriverQueryResult<Row extends PostgresRow = PostgresRow> {
  rows: Row[];
  rowCount?: number | null;
}

export interface NodePostgresDriverClient {
  query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<NodePostgresDriverQueryResult<Row>>;
  end?: () => Promise<void> | void;
}

export interface NodePostgresControlPlaneClientOptions {
  client: NodePostgresDriverClient;
}

export class NodePostgresControlPlaneClient implements PostgresControlPlaneClient {
  constructor(private readonly client: NodePostgresDriverClient) {}

  async query<Row extends PostgresRow = PostgresRow>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.client.query<Row>(sql, params);

    return {
      rows: result.rows,
      ...(result.rowCount === undefined ? {} : { rowCount: result.rowCount })
    };
  }

  async end(): Promise<void> {
    await this.client.end?.();
  }
}
