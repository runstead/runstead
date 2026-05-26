import { constants } from "node:fs";
import { access } from "node:fs/promises";

import {
  resolveRuntimeBackendSelection,
  type RuntimeBackendConfigEnv
} from "@runstead/runtime";
import {
  formatRunsteadSchemaValidation,
  validateRunsteadDatabaseSchema
} from "@runstead/state-sqlite";

import { errorMessage, fail, pass, type DoctorCheck } from "./doctor-types.js";

export async function checkStateDatabase(path: string): Promise<DoctorCheck> {
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

export function checkRuntimeBackend(
  root: string,
  env: RuntimeBackendConfigEnv
): DoctorCheck {
  try {
    const selection = resolveRuntimeBackendSelection({
      rootPath: root,
      env
    });

    if (selection.backend === "sqlite") {
      return pass(
        "runtime-backend",
        "runtime backend",
        `sqlite local backend: ${selection.storage.stateUri}`
      );
    }

    if (selection.setupBlockers.length > 0) {
      return fail(
        "runtime-backend",
        "runtime backend",
        selection.setupBlockers.join("; ")
      );
    }

    const capabilities = selection.teamAssessment?.capabilities;

    return pass(
      "runtime-backend",
      "runtime backend",
      `postgres team backend: runners=${capabilities?.registeredRunners ?? 0} storage=${selection.storage.stateUri}`
    );
  } catch (error) {
    return fail("runtime-backend", "runtime backend", errorMessage(error));
  }
}
