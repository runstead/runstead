import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type DoctorCheckStatus = "pass" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  root: string;
  checks: DoctorCheck[];
}

export interface DoctorRunsteadOptions {
  cwd?: string;
}

const REQUIRED_TABLES = ["goals", "tasks", "evidence", "events"];

export async function doctorRunstead(
  options: DoctorRunsteadOptions = {}
): Promise<DoctorResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = join(cwd, ".runstead");
  const checks: DoctorCheck[] = [];

  checks.push(
    await checkReadableFile("config", "config.yaml", join(root, "config.yaml"))
  );
  checks.push(
    await checkReadableFile("events", "events.jsonl", join(root, "events.jsonl"))
  );
  checks.push(
    await checkReadableFile(
      "domain-pack",
      "repo-maintenance domain pack",
      join(root, "domains", "repo-maintenance", "domain.yaml")
    )
  );
  checks.push(
    await checkReadableFile(
      "policy",
      "repo-maintenance policy",
      join(root, "policies", "repo-maintenance.yaml")
    )
  );
  checks.push(
    await checkDirectory("evidence-dir", "evidence directory", join(root, "evidence"))
  );
  checks.push(await checkDirectory("logs-dir", "logs directory", join(root, "logs")));
  checks.push(
    await checkDirectory(
      "checkpoints-dir",
      "checkpoints directory",
      join(root, "checkpoints")
    )
  );
  checks.push(
    await checkDirectory("reports-dir", "reports directory", join(root, "reports"))
  );
  checks.push(await checkStateDatabase(join(root, "state.db")));

  return {
    ok: checks.every((check) => check.status === "pass"),
    root,
    checks
  };
}

async function checkReadableFile(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    await access(path, constants.R_OK);

    const pathStat = await stat(path);
    if (!pathStat.isFile()) {
      return fail(id, label, `${path} is not a file`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

async function checkDirectory(
  id: string,
  label: string,
  path: string
): Promise<DoctorCheck> {
  try {
    const pathStat = await stat(path);

    if (!pathStat.isDirectory()) {
      return fail(id, label, `${path} is not a directory`);
    }

    return pass(id, label, path);
  } catch (error) {
    return fail(id, label, errorMessage(error));
  }
}

async function checkStateDatabase(path: string): Promise<DoctorCheck> {
  try {
    await access(path, constants.R_OK);
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path, { readOnly: true });

    try {
      const rows = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const tableNames = new Set(rows.map((row) => row.name));
      const missing = REQUIRED_TABLES.filter((table) => !tableNames.has(table));

      if (missing.length > 0) {
        return fail("state-db", "state.db", `missing tables: ${missing.join(", ")}`);
      }

      return pass("state-db", "state.db", path);
    } finally {
      database.close();
    }
  } catch (error) {
    return fail("state-db", "state.db", errorMessage(error));
  }
}

function pass(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "pass",
    message
  };
}

function fail(id: string, label: string, message: string): DoctorCheck {
  return {
    id,
    label,
    status: "fail",
    message
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
