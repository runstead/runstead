import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { validateDomainPackDir } from "@runstead/domain-packs";

import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { resolveRunsteadRoot } from "./runstead-root.js";

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

const REQUIRED_TABLES = [
  "goals",
  "tasks",
  "evidence",
  "policy_decisions",
  "approvals",
  "worker_runs",
  "tool_calls",
  "memory_records",
  "repositories",
  "events"
];

export async function doctorRunstead(
  options: DoctorRunsteadOptions = {}
): Promise<DoctorResult> {
  const resolvedRoot = await resolveRunsteadRoot(options.cwd);
  const root = resolvedRoot.root;
  const cwd = resolvedRoot.cwd;
  const checks: DoctorCheck[] = [];

  checks.push(
    await checkReadableFile("config", "config.yaml", join(root, "config.yaml"))
  );
  checks.push(
    await checkReadableFile(
      "domain-pack",
      "repo-maintenance domain pack",
      join(root, "domains", "repo-maintenance", "domain.yaml")
    )
  );
  checks.push(
    await checkDomainPackValidation(join(root, "domains", "repo-maintenance"))
  );
  checks.push(
    await checkReadableFile(
      "policy",
      "repo-maintenance policy",
      join(root, "policies", "repo-maintenance.yaml")
    )
  );
  checks.push(
    await checkPolicyValidation(join(root, "policies", "repo-maintenance.yaml"))
  );
  checks.push(await checkRbacPolicy(cwd));
  checks.push(await checkTeamPolicy(cwd));
  checks.push(await checkGitHubAppConfig(cwd, root));
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

async function checkDomainPackValidation(path: string): Promise<DoctorCheck> {
  try {
    const result = await validateDomainPackDir(path);

    if (!result.valid) {
      return fail(
        "domain-pack-validation",
        "repo-maintenance domain pack validation",
        result.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)
          .join(", ")
      );
    }

    return pass(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      path
    );
  } catch (error) {
    return fail(
      "domain-pack-validation",
      "repo-maintenance domain pack validation",
      errorMessage(error)
    );
  }
}

async function checkPolicyValidation(path: string): Promise<DoctorCheck> {
  try {
    await loadPolicyProfileFromFile(path);

    return pass("policy-validation", "repo-maintenance policy validation", path);
  } catch (error) {
    return fail(
      "policy-validation",
      "repo-maintenance policy validation",
      errorMessage(error)
    );
  }
}

async function checkRbacPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { loadRbacPolicy } = await import("./rbac.js");

    await loadRbacPolicy({ cwd });

    return pass("rbac-policy", "RBAC policy validation", "valid");
  } catch (error) {
    return fail("rbac-policy", "RBAC policy validation", errorMessage(error));
  }
}

async function checkTeamPolicy(cwd: string): Promise<DoctorCheck> {
  try {
    const { compileTeamPolicyProfile, loadTeamPolicy } =
      await import("./team-policy.js");
    const policy = await loadTeamPolicy({ cwd });

    compileTeamPolicyProfile(policy);

    return pass("team-policy", "team policy validation", "valid");
  } catch (error) {
    return fail("team-policy", "team policy validation", errorMessage(error));
  }
}

async function checkGitHubAppConfig(cwd: string, root: string): Promise<DoctorCheck> {
  const path = join(root, "github-app.yaml");

  try {
    await access(path, constants.F_OK);
  } catch {
    return pass("github-app-config", "GitHub App config", "not configured");
  }

  try {
    const { loadGitHubAppConfig } = await import("./github-app.js");
    const config = await loadGitHubAppConfig({ cwd });
    const privateKeyPath = isAbsolute(config.privateKeyPath)
      ? config.privateKeyPath
      : join(root, config.privateKeyPath);

    await access(privateKeyPath, constants.R_OK);

    return pass("github-app-config", "GitHub App config", `app ${config.appId}`);
  } catch (error) {
    return fail("github-app-config", "GitHub App config", errorMessage(error));
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
