import { getCodexAuthStatus } from "./codex-auth.js";
import { resolveCodexModel } from "./codex-model.js";
import {
  errorMessage,
  fail,
  pass,
  type DoctorCheck,
  type DoctorRunsteadOptions
} from "./doctor-types.js";
import {
  modelProviderApiKeyOptional,
  modelProviderResourceId
} from "./doctor-worker-helpers.js";
import { resolveModelProvider, type ResolvedModelProvider } from "./model-provider.js";

export { modelProviderResourceId };

export function checkRunsteadInitialized(resolvedRoot: {
  root: string;
  source: "runstead" | "team" | "missing";
}): DoctorCheck {
  if (resolvedRoot.source === "runstead") {
    return pass("runstead-initialized", ".runstead initialization", resolvedRoot.root);
  }

  if (resolvedRoot.source === "team") {
    return fail(
      "runstead-initialized",
      ".runstead initialization",
      "legacy .team state found; migrate to .runstead before using Codex Direct"
    );
  }

  return fail(
    "runstead-initialized",
    ".runstead initialization",
    `Runstead is not initialized at ${resolvedRoot.root}`
  );
}

export async function checkModelProviderSelection(
  cwd: string,
  codexModelResolver?: DoctorRunsteadOptions["codexModelResolver"],
  env?: NodeJS.ProcessEnv
): Promise<{
  check: DoctorCheck;
  selection?: ResolvedModelProvider;
}> {
  try {
    const selection = await resolveModelProvider({
      cwd,
      ...(env === undefined ? {} : { env })
    });
    let model = selection.model;
    let modelSource: string | undefined = selection.modelSource;

    if (model === undefined && selection.profile.apiMode === "codex_responses") {
      const result = await (codexModelResolver ?? resolveCodexModel)({ cwd });

      model = result.model;
      modelSource = result.source;
    }

    if (model === undefined) {
      return {
        selection,
        check: fail(
          "model-provider",
          "model provider",
          `provider=${selection.provider}; no model selected; configure model.name or pass --model`
        )
      };
    }

    return {
      selection,
      check: pass(
        "model-provider",
        "model provider",
        `provider=${selection.provider} model=${model} mode=${selection.profile.apiMode} source=${selection.providerSource}/${modelSource ?? "unknown"}`
      )
    };
  } catch (error) {
    return {
      check: fail("model-provider", "model provider", errorMessage(error))
    };
  }
}

export function checkModelProviderCredentials(
  selection: ResolvedModelProvider,
  env: NodeJS.ProcessEnv
): DoctorCheck {
  if (modelProviderApiKeyOptional(selection)) {
    return pass(
      "model-provider-auth",
      `${selection.profile.displayName} credentials`,
      "API key optional for local OpenAI-compatible endpoints"
    );
  }

  const envNames =
    selection.apiKeyEnv === undefined
      ? selection.profile.envVars
      : [selection.apiKeyEnv];
  const configured = envNames.find((name) => {
    const value = env[name]?.trim();

    return value !== undefined && value.length > 0;
  });

  if (configured !== undefined) {
    return pass(
      "model-provider-auth",
      `${selection.profile.displayName} credentials`,
      `using ${configured}`
    );
  }

  return fail(
    "model-provider-auth",
    `${selection.profile.displayName} credentials`,
    `missing API key; set ${envNames.join(" or ")} or configure model.apiKeyEnv`
  );
}

export async function checkCodexDirectAuth(
  authStatus?: DoctorRunsteadOptions["codexAuthStatus"]
): Promise<DoctorCheck> {
  try {
    const status = await (authStatus ?? (() => getCodexAuthStatus()))();

    if (!status.loggedIn) {
      return fail(
        "codex-auth",
        "Codex Direct login",
        `not logged in; run runstead codex login (auth store: ${status.authPath})`
      );
    }

    if (status.accessTokenExpired === true) {
      return fail(
        "codex-auth",
        "Codex Direct login",
        "access token expired; run runstead codex login"
      );
    }

    return pass("codex-auth", "Codex Direct login", "logged in");
  } catch (error) {
    return fail("codex-auth", "Codex Direct login", errorMessage(error));
  }
}

export async function checkCodexDefaultModel(
  cwd: string,
  resolver?: DoctorRunsteadOptions["codexModelResolver"]
): Promise<DoctorCheck> {
  try {
    const result = await (resolver ?? resolveCodexModel)({ cwd });

    return pass(
      "codex-default-model",
      "Codex default model",
      `${result.model} (${result.source})`
    );
  } catch (error) {
    return fail("codex-default-model", "Codex default model", errorMessage(error));
  }
}
