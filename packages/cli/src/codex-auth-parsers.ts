import { CODEX_PROVIDER_ID, DEFAULT_CODEX_BASE_URL } from "./codex-auth-constants.js";
import type { CodexAuthState, CodexAuthTokens, CodexModel } from "./codex-auth.js";

interface CodexAuthStateJson {
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  base_url?: unknown;
  last_refresh?: unknown;
  auth_mode?: unknown;
  source?: unknown;
}

export function parseCodexAuthState(raw: unknown): CodexAuthState {
  if (!isRecord(raw)) {
    throw new Error("Codex auth state must be an object");
  }

  const state = raw as CodexAuthStateJson;
  const tokens = state.tokens;
  const accessToken = tokens?.access_token;
  const refreshToken = tokens?.refresh_token;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new Error("Codex auth state is missing access_token");
  }

  if (typeof refreshToken !== "string" || refreshToken.trim().length === 0) {
    throw new Error("Codex auth state is missing refresh_token");
  }

  return normalizeCodexAuthState({
    provider: CODEX_PROVIDER_ID,
    authMode: "chatgpt",
    source:
      state.source === "codex-cli-import" || state.source === "manual"
        ? state.source
        : "device-code",
    baseUrl:
      typeof state.base_url === "string" && state.base_url.trim().length > 0
        ? state.base_url
        : DEFAULT_CODEX_BASE_URL,
    tokens: {
      accessToken,
      refreshToken
    },
    lastRefresh:
      typeof state.last_refresh === "string" && state.last_refresh.trim().length > 0
        ? state.last_refresh
        : new Date(0).toISOString()
  });
}

export function codexAuthStateToJson(state: CodexAuthState): CodexAuthStateJson {
  return {
    tokens: {
      access_token: state.tokens.accessToken,
      refresh_token: state.tokens.refreshToken
    },
    base_url: state.baseUrl,
    last_refresh: state.lastRefresh,
    auth_mode: state.authMode,
    source: state.source
  };
}

export function normalizeCodexAuthState(state: CodexAuthState): CodexAuthState {
  return {
    provider: CODEX_PROVIDER_ID,
    authMode: "chatgpt",
    source: state.source,
    baseUrl: trimTrailingSlash(state.baseUrl || DEFAULT_CODEX_BASE_URL),
    tokens: {
      accessToken: state.tokens.accessToken.trim(),
      refreshToken: state.tokens.refreshToken.trim()
    },
    lastRefresh: state.lastRefresh
  };
}

export function parseCodexCliTokens(raw: unknown): CodexAuthTokens | undefined {
  if (!isRecord(raw) || !isRecord(raw.tokens)) {
    return undefined;
  }

  const accessToken = raw.tokens.access_token;
  const refreshToken = raw.tokens.refresh_token;

  if (
    typeof accessToken !== "string" ||
    accessToken.trim().length === 0 ||
    typeof refreshToken !== "string" ||
    refreshToken.trim().length === 0
  ) {
    return undefined;
  }

  return {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim()
  };
}

export function parseTokenResponsePayload(
  payload: unknown,
  label: string
): CodexAuthTokens {
  if (!isRecord(payload)) {
    throw new Error(`${label} response was not an object`);
  }

  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new Error(`${label} response is missing access_token`);
  }

  return {
    accessToken: accessToken.trim(),
    refreshToken:
      typeof refreshToken === "string" && refreshToken.trim().length > 0
        ? refreshToken.trim()
        : ""
  };
}

export function parseCodexModelsPayload(payload: unknown): CodexModel[] {
  const models =
    isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];

  return models.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = item.slug ?? item.id;

    if (typeof id !== "string" || id.trim().length === 0) {
      return [];
    }

    const contextWindow = item.context_window ?? item.contextWindow;

    return [
      {
        id: id.trim(),
        ...(typeof contextWindow === "number" && Number.isFinite(contextWindow)
          ? { contextWindow }
          : {}),
        raw: { ...item }
      }
    ];
  });
}

export function codexModelsFromEnvironment(): CodexModel[] {
  const configured = process.env.RUNSTEAD_CODEX_MODELS;

  if (configured === undefined || configured.trim().length === 0) {
    return [];
  }

  return configured
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((id) => ({
      id,
      raw: {
        id,
        source: "RUNSTEAD_CODEX_MODELS"
      }
    }));
}

export function resolveCodexBaseUrl(value: string | undefined): string {
  return trimTrailingSlash(
    value ?? process.env.RUNSTEAD_CODEX_BASE_URL ?? DEFAULT_CODEX_BASE_URL
  );
}

export function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function toInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
