import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { resolveRunsteadRoot } from "./runstead-root.js";
import { detectStartupDevServerCommand } from "./startup-dev-server.js";
import {
  parseStartupReadyUiSmokeConfig,
  startupReadyUiSmokePath,
  stringifyStartupReadyUiSmokeConfig,
  type StartupReadyUiSmokeConfig
} from "./startup-ready-ui-smoke-config.js";
import {
  DEFAULT_UI_SMOKE_TIMEOUT_MS,
  defaultStartupReadyUiSmokeConfig
} from "./startup-ready-ui-smoke-default.js";
import {
  classifyStartupUiValidationFailure,
  executeStartupUiValidation,
  summarizeStartupUiValidationFailure,
  startupUiValidationRepairHint
} from "./startup-ui-validation.js";
import type {
  StartupReadyUiSmokeCheckResult,
  StartupReadyUiSmokeRunResult
} from "./startup-ready-ui-smoke-types.js";

export type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeConfig,
  StartupReadyUiSmokeServerConfig
} from "./startup-ready-ui-smoke-config.js";
export type {
  StartupReadyUiSmokeCheckResult,
  StartupReadyUiSmokeRunResult
} from "./startup-ready-ui-smoke-types.js";
export { inferStartupReadyUiSmokeFlowActions } from "./startup-ready-ui-smoke-flow.js";
export { inferStartupReadyUiSmokeExpectText } from "./startup-ready-ui-smoke-expect-text.js";
export { defaultStartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-default.js";

export async function executeStartupReadyUiSmoke(input: {
  cwd?: string;
  now?: Date;
}): Promise<StartupReadyUiSmokeRunResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const loaded = await loadOrCreateStartupReadyUiSmokeConfig(cwd);

  if (loaded.config === undefined) {
    return {
      status: "blocked",
      configPath: loaded.path,
      configStatus: "blocked",
      configWarnings: [],
      configRepairHints: [],
      checks: [],
      evidenceIds: [],
      artifacts: [],
      blockers: [loaded.blocker ?? "UI smoke config is missing"]
    };
  }

  const checks: StartupReadyUiSmokeCheckResult[] = [];

  for (const check of loaded.config.checks) {
    try {
      const url = check.url ?? loaded.config.server.url;
      const result = await executeStartupUiValidation({
        cwd,
        viewport: check.viewport ?? "desktop",
        serverCommand: loaded.config.server.command,
        serverPort: loaded.config.server.port,
        timeoutMs:
          check.timeoutMs ??
          loaded.config.server.timeoutMs ??
          DEFAULT_UI_SMOKE_TIMEOUT_MS,
        expectText: check.expectText,
        ...(check.steps === undefined ? {} : { flowActions: check.steps }),
        ...(url === undefined ? {} : { url }),
        ...(check.flow === undefined ? {} : { criticalFlow: check.flow }),
        ...(input.now === undefined ? {} : { now: input.now })
      });
      const failureSummary = result.failed
        ? summarizeStartupUiValidationFailure(result.execution)
        : undefined;
      const failureCategory = result.failed
        ? classifyStartupUiValidationFailure(result.execution)
        : undefined;
      const repairHint = result.failed
        ? startupUiValidationRepairHint(result.execution)
        : undefined;
      const failedAction = result.failed
        ? result.execution.flowActions?.find((action) => action.status === "fail")
        : undefined;

      checks.push({
        name: check.name,
        status: result.failed ? "failed" : "passed",
        evidenceId: result.evidence.evidence.id,
        artifact: result.domArtifact,
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(failureSummary === undefined ? {} : { failureSummary }),
        ...(repairHint === undefined ? {} : { repairHint }),
        ...(failedAction === undefined ? {} : { failedAction }),
        blockers: result.failed
          ? [
              `UI smoke check failed: ${check.name}: ${failureCategory ?? "unknown"}: ${failureSummary}; suggested patch: ${repairHint}`
            ]
          : []
      });
    } catch (error) {
      checks.push({
        name: check.name,
        status: "failed",
        blockers: [`UI smoke check failed: ${check.name}: ${errorMessage(error)}`]
      });
    }
  }

  const blockers = checks.flatMap((check) => check.blockers);
  const evidenceIds = checks
    .map((check) => check.evidenceId)
    .filter((id): id is string => id !== undefined);
  const artifacts = [
    loaded.path,
    ...checks
      .map((check) => check.artifact)
      .filter((artifact): artifact is string => artifact !== undefined)
  ];

  return {
    status: blockers.length === 0 ? "passed" : "blocked",
    configPath: loaded.path,
    configStatus: loaded.status,
    configWarnings: loaded.warnings,
    configRepairHints: loaded.repairHints,
    checks,
    evidenceIds,
    artifacts,
    blockers
  };
}

async function loadOrCreateStartupReadyUiSmokeConfig(cwd: string): Promise<
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
    }
> {
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
