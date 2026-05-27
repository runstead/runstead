import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRunsteadRoot } from "./runstead-root.js";
import { detectStartupDevServerCommand } from "./startup-dev-server.js";
import {
  parseStartupReadyUiSmokeConfig,
  startupReadyUiSmokePath,
  stringifyStartupReadyUiSmokeConfig,
  type StartupReadyUiSmokeConfig
} from "./startup-ready-ui-smoke-config.js";
import { defaultStartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-default.js";

export type StartupReadyUiSmokeLoadedConfig =
  | {
      path: string;
      status: "loaded" | "generated";
      config: StartupReadyUiSmokeConfig;
      warnings: string[];
      repairHints: string[];
    }
  | {
      path: string;
      status: "blocked";
      blocker: string;
      config?: undefined;
    };

export async function loadOrCreateStartupReadyUiSmokeConfig(
  cwd: string
): Promise<StartupReadyUiSmokeLoadedConfig> {
  const root = await resolveRunsteadRoot(cwd);
  const path = startupReadyUiSmokePath(root.root);
  const existing = await readOptionalTextFile(path);

  if (existing.trim().length > 0) {
    const loaded = parseStartupReadyUiSmokeConfig(existing, path);

    return {
      path,
      status: "loaded",
      config: loaded.config,
      warnings: loaded.warnings,
      repairHints: loaded.repairHints
    };
  }

  try {
    const command = await detectStartupDevServerCommand(cwd);
    const config = await defaultStartupReadyUiSmokeConfig(cwd, command);

    await mkdir(join(root.root, "startup"), { recursive: true });
    await writeFile(path, stringifyStartupReadyUiSmokeConfig(config), "utf8");

    return {
      path,
      status: "generated",
      config,
      warnings: [],
      repairHints: []
    };
  } catch (error) {
    return {
      path,
      status: "blocked",
      blocker: errorMessage(error)
    };
  }
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
