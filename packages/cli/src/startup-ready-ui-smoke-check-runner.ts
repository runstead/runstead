import { DEFAULT_UI_SMOKE_TIMEOUT_MS } from "./startup-ready-ui-smoke-default.js";
import type {
  StartupReadyUiSmokeCheckConfig,
  StartupReadyUiSmokeServerConfig
} from "./startup-ready-ui-smoke-config.js";
import type { StartupReadyUiSmokeCheckResult } from "./startup-ready-ui-smoke-types.js";
import {
  classifyStartupUiValidationFailure,
  executeStartupUiValidation,
  summarizeStartupUiValidationFailure,
  startupUiValidationRepairHint
} from "./startup-ui-validation.js";

export async function runStartupReadyUiSmokeCheck(input: {
  cwd: string;
  server: StartupReadyUiSmokeServerConfig;
  check: StartupReadyUiSmokeCheckConfig;
  now?: Date;
}): Promise<StartupReadyUiSmokeCheckResult> {
  const url = input.check.url ?? input.server.url;

  try {
    const result = await executeStartupUiValidation({
      cwd: input.cwd,
      viewport: input.check.viewport ?? "desktop",
      serverCommand: input.server.command,
      serverPort: input.server.port,
      timeoutMs:
        input.check.timeoutMs ??
        input.server.timeoutMs ??
        DEFAULT_UI_SMOKE_TIMEOUT_MS,
      expectText: input.check.expectText,
      ...(input.check.steps === undefined ? {} : { flowActions: input.check.steps }),
      ...(url === undefined ? {} : { url }),
      ...(input.check.flow === undefined ? {} : { criticalFlow: input.check.flow }),
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

    return {
      name: input.check.name,
      status: result.failed ? "failed" : "passed",
      evidenceId: result.evidence.evidence.id,
      artifact: result.domArtifact,
      ...(failureCategory === undefined ? {} : { failureCategory }),
      ...(failureSummary === undefined ? {} : { failureSummary }),
      ...(repairHint === undefined ? {} : { repairHint }),
      ...(failedAction === undefined ? {} : { failedAction }),
      blockers: result.failed
        ? [
            `UI smoke check failed: ${input.check.name}: ${failureCategory ?? "unknown"}: ${failureSummary}; suggested patch: ${repairHint}`
          ]
        : []
    };
  } catch (error) {
    return {
      name: input.check.name,
      status: "failed",
      blockers: [
        `UI smoke check failed: ${input.check.name}: ${errorMessage(error)}`
      ]
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
