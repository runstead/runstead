import type { ModelProviderProfile } from "./model-provider-types.js";

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

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}
