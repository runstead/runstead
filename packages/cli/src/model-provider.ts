import { readRunsteadConfigValue } from "./config.js";
import { getModelProviderProfile } from "./model-provider-registry.js";
import type {
  ModelProviderProfile,
  ModelProviderSource,
  ResolveModelProviderOptions,
  ResolvedModelProvider
} from "./model-provider-types.js";

export {
  MODEL_PROVIDER_PROFILES,
  getModelProviderProfile,
  listModelProviderProfiles
} from "./model-provider-registry.js";
export type {
  ModelProviderApiMode,
  ModelProviderProfile,
  ModelProviderSource,
  ResolveModelProviderOptions,
  ResolvedModelProvider
} from "./model-provider-types.js";

export async function resolveModelProvider(
  options: ResolveModelProviderOptions = {}
): Promise<ResolvedModelProvider> {
  const env = options.env ?? process.env;
  const configuredProvider = await readOptionalConfig(options.cwd, "model.provider");
  const explicitProvider = normalizeValue(options.explicitProvider);
  const environmentProvider = normalizeValue(env.RUNSTEAD_MODEL_PROVIDER);
  const explicitModel = normalizeValue(options.explicitModel);
  const configuredModel = await readOptionalConfig(options.cwd, "model.name");
  const legacyCodexModel = await readOptionalConfig(options.cwd, "codex.model");
  const environmentModel = normalizeValue(env.RUNSTEAD_MODEL);
  const inferredProvider = inferProviderFromModel(
    explicitModel ?? configuredModel ?? environmentModel
  );
  const providerName =
    explicitProvider ??
    configuredProvider ??
    environmentProvider ??
    inferredProvider ??
    "codex";
  const providerSource: ModelProviderSource =
    explicitProvider !== undefined
      ? "explicit"
      : configuredProvider !== undefined
        ? "config"
        : environmentProvider !== undefined
          ? "environment"
          : inferredProvider !== undefined
            ? "model_prefix"
            : "default";
  const profile = getModelProviderProfile(providerName);
  const model =
    explicitModel ??
    configuredModel ??
    environmentModel ??
    (profile.id === "codex" ? legacyCodexModel : undefined) ??
    profile.defaultModel;
  const modelSource =
    explicitModel !== undefined
      ? "explicit"
      : configuredModel !== undefined
        ? "config"
        : environmentModel !== undefined
          ? "environment"
          : profile.id === "codex" && legacyCodexModel !== undefined
            ? "legacy_codex_config"
            : profile.defaultModel !== undefined
              ? "default"
              : undefined;
  const configuredBaseUrl = await readOptionalConfig(options.cwd, "model.baseUrl");
  const explicitBaseUrl = normalizeValue(options.explicitBaseUrl);
  const environmentBaseUrl = normalizeValue(env.RUNSTEAD_MODEL_BASE_URL);
  const baseUrl =
    explicitBaseUrl ??
    configuredBaseUrl ??
    environmentBaseUrl ??
    profile.defaultBaseUrl;
  const baseUrlSource =
    explicitBaseUrl !== undefined
      ? "explicit"
      : configuredBaseUrl !== undefined
        ? "config"
        : environmentBaseUrl !== undefined
          ? "environment"
          : profile.defaultBaseUrl !== undefined
            ? "default"
            : undefined;
  const configuredApiKeyEnv = await readOptionalConfig(options.cwd, "model.apiKeyEnv");
  const environmentApiKeyEnv = normalizeValue(env.RUNSTEAD_MODEL_API_KEY_ENV);
  const apiKeyEnv =
    configuredApiKeyEnv ?? environmentApiKeyEnv ?? firstConfiguredEnv(profile, env);
  const apiKeyEnvSource =
    configuredApiKeyEnv !== undefined
      ? "config"
      : environmentApiKeyEnv !== undefined
        ? "environment"
        : apiKeyEnv !== undefined
          ? "default"
          : undefined;

  return {
    profile,
    provider: profile.id,
    providerSource,
    ...(model === undefined ? {} : { model }),
    ...(modelSource === undefined ? {} : { modelSource }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(baseUrlSource === undefined ? {} : { baseUrlSource }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(apiKeyEnvSource === undefined ? {} : { apiKeyEnvSource })
  };
}

function inferProviderFromModel(model: string | undefined): string | undefined {
  if (model === undefined) {
    return undefined;
  }

  const normalized = model.toLowerCase();

  if (normalized.startsWith("claude-") || normalized.startsWith("anthropic/")) {
    return "anthropic";
  }

  if (normalized.startsWith("gemini-") || normalized.startsWith("google/")) {
    return "gemini";
  }

  if (normalized.startsWith("openai/")) {
    return "openai";
  }

  if (normalized.startsWith("deepseek/")) {
    return "deepseek";
  }

  if (normalized.startsWith("zai/") || normalized.startsWith("glm-")) {
    return "zai";
  }

  return undefined;
}

function firstConfiguredEnv(
  profile: ModelProviderProfile,
  env: NodeJS.ProcessEnv
): string | undefined {
  return profile.envVars.find((name) => normalizeValue(env[name]) !== undefined);
}

async function readOptionalConfig(
  cwd: string | undefined,
  key: string
): Promise<string | undefined> {
  return readRunsteadConfigValue({
    ...(cwd === undefined ? {} : { cwd }),
    key
  });
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
