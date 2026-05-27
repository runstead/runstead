import { resolve } from "node:path";

import {
  classifyRuntimeStartupUiValidationFailure,
  runtimeStartupUiValidationInfraStatus,
  runtimeStartupUiValidationRepairHint
} from "@runstead/runtime";

import {
  startStartupDevServer,
  type StartupDevServerHandle
} from "./startup-dev-server.js";
import { executeHttpDomValidation } from "./startup-ui-http-dom-validation.js";
import { executeBrowserFlowValidation } from "./startup-ui-browser-flow-validation.js";
import type {
  ExecuteStartupUiValidationOptions,
  ExecuteStartupUiValidationResult
} from "./startup-ui-validation-types.js";

export { recordStartupUiValidation } from "./startup-ui-validation-recorder.js";
export {
  parseStartupUiValidationStatus,
  summarizeStartupUiValidationFailure
} from "./startup-ui-validation-status.js";
export type * from "./startup-ui-validation-types.js";

export const classifyStartupUiValidationFailure =
  classifyRuntimeStartupUiValidationFailure;
export const startupUiValidationRepairHint = runtimeStartupUiValidationRepairHint;
export const startupUiValidationInfraStatus = runtimeStartupUiValidationInfraStatus;

export async function executeStartupUiValidation(
  options: ExecuteStartupUiValidationOptions
): Promise<ExecuteStartupUiValidationResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  let server: StartupDevServerHandle | undefined;
  const flowActions = options.flowActions ?? [];

  try {
    if (options.serverCommand !== undefined || options.url === undefined) {
      server = await startStartupDevServer({
        cwd,
        ...(options.serverCommand === undefined
          ? {}
          : { command: options.serverCommand }),
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.serverPort === undefined ? {} : { port: options.serverPort }),
        timeoutMs: options.timeoutMs ?? 20_000,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
      });
    }

    const url = server?.url ?? options.url;

    if (url === undefined) {
      throw new Error("UI validation execution requires a URL or a dev server command");
    }

    const serverOption = server === undefined ? {} : { server };

    return flowActions.length === 0
      ? await executeHttpDomValidation({ ...options, cwd, url, ...serverOption })
      : await executeBrowserFlowValidation({
          ...options,
          cwd,
          url,
          ...serverOption,
          flowActions
        });
  } finally {
    await server?.stop();
  }
}
