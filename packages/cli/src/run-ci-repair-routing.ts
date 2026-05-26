import type { CodexAuthStatus } from "./codex-auth.js";
import { getCodexAuthStatus } from "./codex-auth.js";
import type { CiRepairWorkerKind } from "./ci-repair-orchestrator-types.js";
import { resolveModelProviderModel } from "./model-provider-runtime.js";

export interface RunOnceModelProvider {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export interface RunCiRepairRoutingOptions {
  codexAuthStatus?: () => Promise<
    Pick<CodexAuthStatus, "loggedIn" | "accessTokenExpired">
  >;
}

export async function resolveOptionalRunModelProvider(
  cwd: string,
  requested: RunOnceModelProvider
): Promise<RunOnceModelProvider> {
  try {
    const resolved = await resolveModelProviderModel({
      cwd,
      ...(requested.provider === undefined
        ? {}
        : { explicitProvider: requested.provider }),
      ...(requested.model === undefined ? {} : { explicitModel: requested.model }),
      ...(requested.baseUrl === undefined ? {} : { explicitBaseUrl: requested.baseUrl })
    });

    return {
      provider: resolved.selection.provider,
      model: resolved.model,
      ...(resolved.selection.baseUrl === undefined
        ? {}
        : { baseUrl: resolved.selection.baseUrl })
    };
  } catch {
    return requested;
  }
}

export async function defaultCiRepairWorker(input: {
  options: RunCiRepairRoutingOptions;
  modelProvider: RunOnceModelProvider;
}): Promise<CiRepairWorkerKind> {
  if (input.modelProvider.model === undefined) {
    return "codex_cli";
  }

  if (
    input.modelProvider.provider !== undefined &&
    input.modelProvider.provider !== "codex"
  ) {
    return "codex_direct";
  }

  const status = await (input.options.codexAuthStatus ?? getCodexAuthStatus)();

  return status.loggedIn && status.accessTokenExpired !== true
    ? "codex_direct"
    : "codex_cli";
}
