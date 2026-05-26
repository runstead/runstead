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
