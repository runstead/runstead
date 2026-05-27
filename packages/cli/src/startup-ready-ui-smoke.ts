import { resolve } from "node:path";

import { runStartupReadyUiSmokeCheck } from "./startup-ready-ui-smoke-check-runner.js";
import { loadOrCreateStartupReadyUiSmokeConfig } from "./startup-ready-ui-smoke-loader.js";
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
    checks.push(
      await runStartupReadyUiSmokeCheck({
        cwd,
        server: loaded.config.server,
        check,
        ...(input.now === undefined ? {} : { now: input.now })
      })
    );
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
