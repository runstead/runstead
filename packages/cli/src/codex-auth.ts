import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { withCodexAuthLock } from "./codex-auth-store.js";
import { readCodexModelCache, writeCodexModelCache } from "./codex-auth-model-cache.js";
import {
  CODEX_AUTH_REFRESH_SKEW_SECONDS,
  CODEX_OAUTH_TOKEN_URL,
  CODEX_PROVIDER_ID
} from "./codex-auth-constants.js";
import {
  exchangeCodexAuthorizationCode,
  pollCodexDeviceAuthorization,
  refreshCodexAuthTokens,
  requestCodexDeviceCode
} from "./codex-auth-oauth.js";
import {
  codexModelsFromEnvironment,
  normalizeCodexAuthState,
  parseCodexCliTokens,
  parseCodexModelsPayload,
  resolveCodexBaseUrl,
  trimTrailingSlash
} from "./codex-auth-parsers.js";
import { codexBackendHeaders, isCodexAccessTokenExpiring } from "./codex-auth-token.js";
import { requireCodexAuthState, saveCodexAuthState } from "./codex-auth-state.js";
import type {
  CodexAuthState,
  CodexDeviceCode,
  CodexDeviceLoginOptions,
  CodexModel,
  CodexRuntimeCredentials,
  ImportCodexCliTokensOptions,
  ListCodexModelsOptions,
  ResolveCodexRuntimeCredentialsOptions
} from "./codex-auth-types.js";

export {
  CODEX_AUTH_REFRESH_SKEW_SECONDS,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
  CODEX_PROVIDER_ID,
  DEFAULT_CODEX_BASE_URL
} from "./codex-auth-constants.js";
export {
  codexModelsFromEnvironment,
  resolveCodexBaseUrl
} from "./codex-auth-parsers.js";
export {
  codexAuthStorePath,
  codexModelCachePath,
  resolveRunsteadHome,
  type CodexAuthStoreOptions
} from "./codex-auth-store.js";
export { readCodexModelCache } from "./codex-auth-model-cache.js";
export {
  codexAccessTokenExpiresAt,
  codexBackendHeaders,
  isCodexAccessTokenExpiring
} from "./codex-auth-token.js";
export {
  clearCodexAuthState,
  getCodexAuthStatus,
  readCodexAuthState,
  requireCodexAuthState,
  saveCodexAuthState
} from "./codex-auth-state.js";
export { formatCodexAuthStatus, formatCodexModels } from "./codex-auth-format.js";
export type {
  CodexAuthState,
  CodexAuthStatus,
  CodexAuthTokens,
  CodexDeviceCode,
  CodexDeviceLoginOptions,
  CodexModel,
  CodexModelCacheFile,
  CodexRuntimeCredentials,
  FetchLike,
  ImportCodexCliTokensOptions,
  ListCodexModelsOptions,
  ResolveCodexRuntimeCredentialsOptions
} from "./codex-auth-types.js";

export async function loginCodexWithDeviceCode(
  options: CodexDeviceLoginOptions = {}
): Promise<{ authPath: string; state: CodexAuthState; deviceCode: CodexDeviceCode }> {
  const fetchFn = options.fetch ?? fetch;
  const issuer = trimTrailingSlash(options.issuer ?? "https://auth.openai.com");
  const tokenUrl = options.tokenUrl ?? CODEX_OAUTH_TOKEN_URL;
  const baseUrl = resolveCodexBaseUrl(options.baseUrl);
  const deviceCode = await requestCodexDeviceCode({
    fetch: fetchFn,
    issuer
  });

  options.onDeviceCode?.(deviceCode);

  const authorization = await pollCodexDeviceAuthorization({
    fetch: fetchFn,
    issuer,
    deviceCode,
    timeoutMs: options.timeoutMs ?? 15 * 60_000
  });
  const tokens = await exchangeCodexAuthorizationCode({
    fetch: fetchFn,
    tokenUrl,
    issuer,
    authorizationCode: authorization.authorizationCode,
    codeVerifier: authorization.codeVerifier
  });
  const state = normalizeCodexAuthState({
    provider: CODEX_PROVIDER_ID,
    authMode: "chatgpt",
    source: "device-code",
    baseUrl,
    tokens,
    lastRefresh: (options.now ?? new Date()).toISOString()
  });
  const saved = await saveCodexAuthState(state, options);

  return {
    ...saved,
    deviceCode
  };
}

export async function importCodexCliTokens(
  options: ImportCodexCliTokensOptions = {}
): Promise<{ authPath: string; state: CodexAuthState } | undefined> {
  const authPath = join(resolveCodexCliHome(options), "auth.json");

  try {
    await access(authPath, constants.R_OK);
  } catch {
    return undefined;
  }

  const raw = JSON.parse(await readFile(authPath, "utf8")) as unknown;
  const tokens = parseCodexCliTokens(raw);

  if (tokens === undefined) {
    return undefined;
  }

  if (isCodexAccessTokenExpiring(tokens.accessToken, 0, options.now)) {
    return undefined;
  }

  const state = normalizeCodexAuthState({
    provider: CODEX_PROVIDER_ID,
    authMode: "chatgpt",
    source: "codex-cli-import",
    baseUrl: resolveCodexBaseUrl(options.baseUrl),
    tokens,
    lastRefresh: (options.now ?? new Date()).toISOString()
  });

  return saveCodexAuthState(state, options);
}

export async function resolveCodexRuntimeCredentials(
  options: ResolveCodexRuntimeCredentialsOptions = {}
): Promise<CodexRuntimeCredentials> {
  let state = await requireCodexAuthState(options);
  const refreshIfExpiring = options.refreshIfExpiring !== false;
  let shouldRefresh = options.forceRefresh === true;

  if (!shouldRefresh && refreshIfExpiring) {
    shouldRefresh = isCodexAccessTokenExpiring(
      state.tokens.accessToken,
      options.refreshSkewSeconds ?? CODEX_AUTH_REFRESH_SKEW_SECONDS,
      options.now
    );
  }

  if (shouldRefresh) {
    state = await withCodexAuthLock(options, async () => {
      const latest = await requireCodexAuthState(options);
      let latestShouldRefresh = options.forceRefresh === true;

      if (!latestShouldRefresh && refreshIfExpiring) {
        latestShouldRefresh = isCodexAccessTokenExpiring(
          latest.tokens.accessToken,
          options.refreshSkewSeconds ?? CODEX_AUTH_REFRESH_SKEW_SECONDS,
          options.now
        );
      }

      if (!latestShouldRefresh) {
        return latest;
      }

      const refreshed = await refreshCodexAuthTokens({
        fetch: options.fetch ?? fetch,
        tokens: latest.tokens,
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const updated = normalizeCodexAuthState({
        ...latest,
        tokens: refreshed.tokens,
        lastRefresh: refreshed.lastRefresh
      });

      await saveCodexAuthState(updated, options);
      return updated;
    });
  }

  return {
    provider: CODEX_PROVIDER_ID,
    baseUrl: state.baseUrl,
    accessToken: state.tokens.accessToken,
    source: state.source,
    authMode: state.authMode,
    lastRefresh: state.lastRefresh
  };
}

export async function listCodexModels(
  options: ListCodexModelsOptions = {}
): Promise<CodexModel[]> {
  const credentials = await resolveCodexRuntimeCredentials(options);
  const url = new URL(`${trimTrailingSlash(credentials.baseUrl)}/models`);

  url.searchParams.set("client_version", options.clientVersion ?? "1.0.0");

  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: "GET",
      headers: {
        ...codexBackendHeaders(credentials.accessToken),
        Accept: "application/json",
        Authorization: `Bearer ${credentials.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Codex models request failed with status ${response.status}`);
    }

    const models = parseCodexModelsPayload(await response.json());

    await writeCodexModelCache(models, options);
    return models;
  } catch (error) {
    const cached = await readCodexModelCache(options);

    if (cached.length > 0) {
      return cached;
    }

    const configured = codexModelsFromEnvironment();

    if (configured.length > 0) {
      return configured;
    }

    throw error;
  }
}

function resolveCodexCliHome(options: ImportCodexCliTokensOptions): string {
  const configured = options.codexHome ?? process.env.CODEX_HOME;

  if (configured !== undefined && configured.trim().length > 0) {
    return resolve(configured);
  }

  return join(homedir(), ".codex");
}
