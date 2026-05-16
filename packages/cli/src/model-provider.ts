import { readRunsteadConfigValue } from "./config.js";

export type ModelProviderApiMode =
  | "codex_responses"
  | "openai_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content";

export interface ModelProviderProfile {
  id: string;
  displayName: string;
  apiMode: ModelProviderApiMode;
  aliases?: string[];
  defaultBaseUrl?: string;
  envVars: string[];
  defaultModel?: string;
}

export type ModelProviderSource =
  | "explicit"
  | "config"
  | "environment"
  | "model_prefix"
  | "default";

export interface ResolveModelProviderOptions {
  cwd?: string;
  explicitProvider?: string;
  explicitModel?: string;
  explicitBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedModelProvider {
  profile: ModelProviderProfile;
  provider: string;
  providerSource: ModelProviderSource;
  model?: string;
  modelSource?: Exclude<ModelProviderSource, "model_prefix"> | "legacy_codex_config";
  baseUrl?: string;
  baseUrlSource?: Exclude<ModelProviderSource, "model_prefix">;
  apiKeyEnv?: string;
  apiKeyEnvSource?: Exclude<ModelProviderSource, "model_prefix">;
}

export const MODEL_PROVIDER_PROFILES: readonly ModelProviderProfile[] = [
  {
    id: "codex",
    displayName: "OpenAI Codex",
    apiMode: "codex_responses",
    aliases: ["openai-codex", "codex-direct"],
    envVars: []
  },
  {
    id: "openai",
    displayName: "OpenAI",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.openai.com/v1",
    envVars: ["OPENAI_API_KEY"]
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    envVars: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"]
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    apiMode: "anthropic_messages",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    envVars: ["ANTHROPIC_API_KEY"]
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    apiMode: "gemini_generate_content",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
  },
  {
    id: "nous-api",
    displayName: "Nous Portal API",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://inference-api.nousresearch.com/v1",
    envVars: ["NOUS_API_KEY"]
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    envVars: ["DEEPSEEK_API_KEY"]
  },
  {
    id: "zai",
    displayName: "Z.AI GLM",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    envVars: ["GLM_API_KEY", "ZAI_API_KEY"]
  },
  {
    id: "kimi-coding",
    displayName: "Kimi / Moonshot",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    envVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY"]
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.minimax.io/v1",
    envVars: ["MINIMAX_API_KEY"]
  },
  {
    id: "minimax-cn",
    displayName: "MiniMax China",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    envVars: ["MINIMAX_CN_API_KEY"]
  },
  {
    id: "huggingface",
    displayName: "Hugging Face Inference",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    envVars: ["HF_TOKEN", "HUGGINGFACE_API_KEY"]
  },
  {
    id: "nvidia",
    displayName: "NVIDIA NIM",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    envVars: ["NVIDIA_API_KEY"]
  },
  {
    id: "xiaomi",
    displayName: "Xiaomi MiMo",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    envVars: ["XIAOMI_API_KEY"]
  },
  {
    id: "arcee",
    displayName: "Arcee",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://api.arcee.ai/v1",
    envVars: ["ARCEEAI_API_KEY"]
  },
  {
    id: "ollama-cloud",
    displayName: "Ollama Cloud",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://ollama.com/v1",
    envVars: ["OLLAMA_API_KEY"]
  },
  {
    id: "kilocode",
    displayName: "KiloCode",
    apiMode: "openai_chat_completions",
    envVars: ["KILOCODE_API_KEY"]
  },
  {
    id: "ai-gateway",
    displayName: "Vercel AI Gateway",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "https://ai-gateway.vercel.sh/v1",
    envVars: ["AI_GATEWAY_API_KEY"]
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    apiMode: "openai_chat_completions",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    envVars: ["LM_API_KEY", "LMSTUDIO_API_KEY"]
  },
  {
    id: "custom",
    displayName: "Custom OpenAI-compatible endpoint",
    apiMode: "openai_chat_completions",
    aliases: ["ollama", "vllm", "llamacpp"],
    envVars: ["RUNSTEAD_MODEL_API_KEY", "OPENAI_API_KEY"]
  }
];

export function listModelProviderProfiles(): readonly ModelProviderProfile[] {
  return MODEL_PROVIDER_PROFILES;
}

export function getModelProviderProfile(idOrAlias: string): ModelProviderProfile {
  const normalized = normalizeProviderId(idOrAlias);
  const profile = MODEL_PROVIDER_PROFILES.find(
    (candidate) =>
      candidate.id === normalized ||
      candidate.aliases?.some((alias) => normalizeProviderId(alias) === normalized) ===
        true
  );

  if (profile === undefined) {
    throw new Error(
      `Unsupported model provider: ${idOrAlias}. Supported providers: ${MODEL_PROVIDER_PROFILES.map((candidate) => candidate.id).join(", ")}`
    );
  }

  return profile;
}

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

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
