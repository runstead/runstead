import { formatPostgresControlPlaneMigrationSql } from "@runstead/state-postgres";

export interface TeamControlPlaneMigrationSqlOptions {
  schema?: string;
}

export function teamControlPlaneMigrationSql(
  options: TeamControlPlaneMigrationSqlOptions = {}
): string {
  return formatPostgresControlPlaneMigrationSql({
    ...(options.schema === undefined ? {} : { schema: options.schema })
  });
}
