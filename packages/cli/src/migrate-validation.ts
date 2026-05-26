import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { validateDomainPackDir } from "@runstead/domain-packs";
import {
  formatRunsteadSchemaValidation,
  validateRunsteadDatabaseSchema
} from "@runstead/state-sqlite";

import { loadPolicyProfileFromFile } from "./policy-loader.js";

export type MigrationValidationCheckStatus = "pass" | "fail";

export interface MigrationValidationCheck {
  id: string;
  label: string;
  status: MigrationValidationCheckStatus;
  message: string;
}

export async function assertValidMigratedRunsteadRoot(
  root: string,
  label: string
): Promise<MigrationValidationCheck[]> {
  const validation = await validateMigratedRunsteadRoot(root);
  const failed = validation.filter((check) => check.status === "fail");

  if (failed.length > 0) {
    throw new Error(
      `${label} is not a complete Runstead state: ${failed
        .map((check) => check.id)
        .join(", ")}`
    );
  }

  return validation;
}

export async function validateMigratedRunsteadRoot(
  root: string
): Promise<MigrationValidationCheck[]> {
  const resolvedRoot = resolve(root);
  const checks: MigrationValidationCheck[] = [];

  checks.push(
    await checkReadableFile("config", "config.yaml", join(resolvedRoot, "config.yaml"))
  );
  checks.push(
    await checkReadableFile(
      "domain-pack",
      "repo-maintenance domain pack",
      join(resolvedRoot, "domains", "repo-maintenance", "domain.yaml")
    )
  );
  checks.push(
    await checkDomainPackValidation(join(resolvedRoot, "domains", "repo-maintenance"))
  );
  checks.push(
    await checkReadableFile(
      "policy",
      "repo-maintenance policy",
      join(resolvedRoot, "policies", "repo-maintenance.yaml")
    )
  );
  checks.push(
    await checkPolicyValidation(join(resolvedRoot, "policies", "repo-maintenance.yaml"))
  );
  checks.push(
    await checkReadableFile(
      "rbac-policy",
      "RBAC policy",
      join(resolvedRoot, "rbac.yaml")
    )
  );
  checks.push(
    await checkReadableFile(
      "team-policy",
      "team policy",
      join(resolvedRoot, "team-policy.yaml")
    )
  );
  checks.push(
    await checkDirectory(
      "evidence-dir",
      "evidence directory",
      join(resolvedRoot, "evidence")
    )
  );
  checks.push(
    await checkDirectory("logs-dir", "logs directory", join(resolvedRoot, "logs"))
  );
  checks.push(
    await checkDirectory(
      "checkpoints-dir",
      "checkpoints directory",
      join(resolvedRoot, "checkpoints")
    )
  );
  checks.push(
    await checkDirectory(
      "reports-dir",
      "reports directory",
      join(resolvedRoot, "reports")
    )
  );
  checks.push(await checkStateDatabase(join(resolvedRoot, "state.db")));

  return checks;
}

async function checkReadableFile(
  id: string,
  label: string,
  path: string
): Promise<MigrationValidationCheck> {
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
): Promise<MigrationValidationCheck> {
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

async function checkDomainPackValidation(
  path: string
): Promise<MigrationValidationCheck> {
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

async function checkPolicyValidation(path: string): Promise<MigrationValidationCheck> {
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

async function checkStateDatabase(path: string): Promise<MigrationValidationCheck> {
  try {
    await access(path, constants.R_OK);
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path, { readOnly: true });

    try {
      const validation = validateRunsteadDatabaseSchema(database);

      if (!validation.ok) {
        return fail("state-db", "state.db", formatRunsteadSchemaValidation(validation));
      }

      return pass(
        "state-db",
        "state.db",
        `${formatRunsteadSchemaValidation(validation)}: ${path}`
      );
    } finally {
      database.close();
    }
  } catch (error) {
    return fail("state-db", "state.db", errorMessage(error));
  }
}

function pass(id: string, label: string, message: string): MigrationValidationCheck {
  return {
    id,
    label,
    status: "pass",
    message
  };
}

function fail(id: string, label: string, message: string): MigrationValidationCheck {
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
