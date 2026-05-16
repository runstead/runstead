import {
  createCodexDirectTransport,
  type CodexDirectTransport
} from "./codex-direct-worker.js";
import { resolveCodexRuntimeCredentials } from "./codex-auth.js";
import { resolveCodexModel } from "./codex-model.js";
import { AnthropicMessagesTransport } from "./anthropic-messages-transport.js";
import { GeminiGenerateContentTransport } from "./gemini-generate-content-transport.js";
import { resolveModelProvider, type ResolvedModelProvider } from "./model-provider.js";
import { OpenAiChatCompletionsTransport } from "./openai-chat-completions-transport.js";

export interface ResolveModelProviderRuntimeOptions {
  cwd?: string;
  explicitProvider?: string;
  explicitModel?: string;
  explicitBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface ResolvedModelProviderRuntime {
  selection: ResolvedModelProvider;
  model: string;
  modelProviderResourceId: string;
  networkDomains: string[];
  transport: CodexDirectTransport;
}

export async function resolveModelProviderModel(
  options: ResolveModelProviderRuntimeOptions = {}
): Promise<{
  selection: ResolvedModelProvider;
  model: string;
  modelProviderResourceId: string;
  networkDomains: string[];
}> {
  const selection = await resolveModelProvider(options);
  const model =
    selection.model ??
    (selection.provider === "codex"
      ? (
          await resolveCodexModel({
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.explicitModel === undefined
              ? {}
              : { explicitModel: options.explicitModel })
          })
        ).model
      : undefined);

  if (model === undefined) {
    throw new Error(
      `No model selected for provider ${selection.provider}. Pass --model <model> or run runstead config set model.name <model>.`
    );
  }

  return {
    selection,
    model,
    modelProviderResourceId: modelProviderResourceId(selection),
    networkDomains: providerNetworkDomains(selection)
  };
}

export async function createModelProviderRuntime(
  options: ResolveModelProviderRuntimeOptions = {}
): Promise<ResolvedModelProviderRuntime> {
  const resolved = await resolveModelProviderModel(options);
  const transport = await createRuntimeTransport(resolved.selection, options);

  return {
    ...resolved,
    transport
  };
}

async function createRuntimeTransport(
  selection: ResolvedModelProvider,
  options: ResolveModelProviderRuntimeOptions
): Promise<CodexDirectTransport> {
  switch (selection.profile.apiMode) {
    case "codex_responses": {
      const credentials = await resolveCodexRuntimeCredentials({
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return createCodexDirectTransport({
        baseUrl: credentials.baseUrl,
        accessToken: credentials.accessToken
      });
    }

    case "openai_chat_completions":
      return new OpenAiChatCompletionsTransport({
        baseUrl: requireBaseUrl(selection),
        ...optionalApiKey(selection, options.env ?? process.env)
      });

    case "anthropic_messages":
      return new AnthropicMessagesTransport({
        baseUrl: requireBaseUrl(selection),
        apiKey: requireApiKey(selection, options.env ?? process.env)
      });

    case "gemini_generate_content":
      return new GeminiGenerateContentTransport({
        baseUrl: requireBaseUrl(selection),
        apiKey: requireApiKey(selection, options.env ?? process.env)
      });
  }
}

function optionalApiKey(
  selection: ResolvedModelProvider,
  env: NodeJS.ProcessEnv
): { apiKey?: string } {
  const apiKey = resolveApiKey(selection, env);

  if (apiKey !== undefined) {
    return { apiKey };
  }

  if (selection.provider === "custom" || selection.provider === "lmstudio") {
    return {};
  }

  return {
    apiKey: requireApiKey(selection, env)
  };
}

function requireApiKey(
  selection: ResolvedModelProvider,
  env: NodeJS.ProcessEnv
): string {
  const apiKey = resolveApiKey(selection, env);

  if (apiKey !== undefined) {
    return apiKey;
  }

  throw new Error(
    `Model provider ${selection.provider} requires an API key. Set one of: ${selection.profile.envVars.join(", ")}; or configure model.apiKeyEnv.`
  );
}

function resolveApiKey(
  selection: ResolvedModelProvider,
  env: NodeJS.ProcessEnv
): string | undefined {
  const envNames =
    selection.apiKeyEnv === undefined
      ? selection.profile.envVars
      : [selection.apiKeyEnv];

  for (const name of envNames) {
    const value = env[name]?.trim();

    if (value !== undefined && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function requireBaseUrl(selection: ResolvedModelProvider): string {
  if (selection.baseUrl !== undefined) {
    return selection.baseUrl;
  }

  throw new Error(
    `Model provider ${selection.provider} requires a base URL. Configure model.baseUrl.`
  );
}

function modelProviderResourceId(selection: ResolvedModelProvider): string {
  return selection.provider === "codex" ? "chatgpt_codex" : selection.provider;
}

function providerNetworkDomains(selection: ResolvedModelProvider): string[] {
  if (selection.baseUrl === undefined) {
    return selection.provider === "codex" ? ["chatgpt.com"] : [];
  }

  try {
    return [new URL(selection.baseUrl).hostname];
  } catch {
    return [];
  }
}
