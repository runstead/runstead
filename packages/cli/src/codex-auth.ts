import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  codexAuthStorePath,
  codexModelCachePath,
  isNodeErrorCode,
  readCodexAuthStore,
  withCodexAuthLock,
  writeCodexAuthStore,
  type CodexAuthStoreOptions
} from "./codex-auth-store.js";
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
  codexAuthStateToJson,
  codexModelsFromEnvironment,
  isRecord,
  normalizeCodexAuthState,
  parseCodexAuthState,
  parseCodexCliTokens,
  parseCodexModelsPayload,
  resolveCodexBaseUrl,
  trimTrailingSlash
} from "./codex-auth-parsers.js";
import {
  codexAccessTokenExpiresAt,
  codexBackendHeaders,
  isCodexAccessTokenExpiring
} from "./codex-auth-token.js";

export interface CodexAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface CodexAuthState {
  provider: typeof CODEX_PROVIDER_ID;
  authMode: "chatgpt";
  source: "device-code" | "codex-cli-import" | "manual";
  baseUrl: string;
  tokens: CodexAuthTokens;
  lastRefresh: string;
}

export interface CodexAuthStatus {
  loggedIn: boolean;
  authPath: string;
  provider: typeof CODEX_PROVIDER_ID;
  baseUrl?: string;
  source?: CodexAuthState["source"];
  authMode?: CodexAuthState["authMode"];
  lastRefresh?: string;
  hasRefreshToken?: boolean;
  accessTokenExpiresAt?: string;
  accessTokenExpired?: boolean;
}

export interface CodexRuntimeCredentials {
  provider: typeof CODEX_PROVIDER_ID;
  baseUrl: string;
  accessToken: string;
  source: CodexAuthState["source"];
  authMode: CodexAuthState["authMode"];
  lastRefresh: string;
}

export interface CodexModel {
  id: string;
  contextWindow?: number;
  raw: Record<string, unknown>;
}

export interface CodexModelCacheFile {
  version: 1;
  provider: typeof CODEX_PROVIDER_ID;
  fetchedAt: string;
  models: CodexModel[];
}

export interface CodexDeviceCode {
  userCode: string;
  deviceAuthId: string;
  verificationUrl: string;
  pollIntervalMs: number;
}

export interface CodexDeviceLoginOptions extends CodexAuthStoreOptions {
  fetch?: FetchLike;
  issuer?: string;
  tokenUrl?: string;
  baseUrl?: string;
  timeoutMs?: number;
  onDeviceCode?: (deviceCode: CodexDeviceCode) => void;
}

export interface ResolveCodexRuntimeCredentialsOptions extends CodexAuthStoreOptions {
  fetch?: FetchLike;
  forceRefresh?: boolean;
  refreshIfExpiring?: boolean;
  refreshSkewSeconds?: number;
  lockTimeoutMs?: number;
}

export interface ListCodexModelsOptions extends ResolveCodexRuntimeCredentialsOptions {
  clientVersion?: string;
}

export interface ImportCodexCliTokensOptions extends CodexAuthStoreOptions {
  codexHome?: string;
  baseUrl?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
export {
  codexAccessTokenExpiresAt,
  codexBackendHeaders,
  isCodexAccessTokenExpiring
} from "./codex-auth-token.js";
export { formatCodexAuthStatus, formatCodexModels } from "./codex-auth-format.js";

export async function readCodexAuthState(
  options: CodexAuthStoreOptions = {}
): Promise<CodexAuthState | undefined> {
  const store = await readCodexAuthStore(options);
  const raw = store.providers[CODEX_PROVIDER_ID];

  if (raw === undefined) {
    return undefined;
  }

  return parseCodexAuthState(raw);
}

export async function requireCodexAuthState(
  options: CodexAuthStoreOptions = {}
): Promise<CodexAuthState> {
  const state = await readCodexAuthState(options);

  if (state === undefined) {
    throw new Error(`No Codex credentials stored. Run \`runstead codex login\` first.`);
  }

  return state;
}

export async function saveCodexAuthState(
  state: CodexAuthState,
  options: CodexAuthStoreOptions = {}
): Promise<{ authPath: string; state: CodexAuthState }> {
  const store = await readCodexAuthStore(options);
  const authPath = codexAuthStorePath(options);

  store.providers[CODEX_PROVIDER_ID] = codexAuthStateToJson(state);
  await writeCodexAuthStore(authPath, store);

  return {
    authPath,
    state
  };
}

export async function clearCodexAuthState(
  options: CodexAuthStoreOptions = {}
): Promise<{ authPath: string; cleared: boolean }> {
  const store = await readCodexAuthStore(options);
  const authPath = codexAuthStorePath(options);
  const cleared = store.providers[CODEX_PROVIDER_ID] !== undefined;

  delete store.providers[CODEX_PROVIDER_ID];
  await writeCodexAuthStore(authPath, store);

  return {
    authPath,
    cleared
  };
}

export async function getCodexAuthStatus(
  options: CodexAuthStoreOptions = {}
): Promise<CodexAuthStatus> {
  const state = await readCodexAuthState(options);
  const authPath = codexAuthStorePath(options);

  if (state === undefined) {
    return {
      loggedIn: false,
      authPath,
      provider: CODEX_PROVIDER_ID
    };
  }

  const expiresAt = codexAccessTokenExpiresAt(state.tokens.accessToken);
  const expired = isCodexAccessTokenExpiring(state.tokens.accessToken, 0, options.now);

  return {
    loggedIn: true,
    authPath,
    provider: CODEX_PROVIDER_ID,
    baseUrl: state.baseUrl,
    source: state.source,
    authMode: state.authMode,
    lastRefresh: state.lastRefresh,
    hasRefreshToken: state.tokens.refreshToken.length > 0,
    ...(expiresAt === undefined ? {} : { accessTokenExpiresAt: expiresAt }),
    accessTokenExpired: expired
  };
}

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

export async function readCodexModelCache(
  options: CodexAuthStoreOptions = {}
): Promise<CodexModel[]> {
  try {
    const raw = JSON.parse(
      await readFile(codexModelCachePath(options), "utf8")
    ) as unknown;

    if (!isRecord(raw) || !Array.isArray(raw.models)) {
      return [];
    }

    return parseCodexModelsPayload({ models: raw.models });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function writeCodexModelCache(
  models: CodexModel[],
  options: CodexAuthStoreOptions
): Promise<void> {
  const cachePath = codexModelCachePath(options);
  const payload: CodexModelCacheFile = {
    version: 1,
    provider: CODEX_PROVIDER_ID,
    fetchedAt: (options.now ?? new Date()).toISOString(),
    models
  };
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmpPath, 0o600).catch(() => undefined);
  await rename(tmpPath, cachePath);
  await chmod(cachePath, 0o600).catch(() => undefined);
}

function resolveCodexCliHome(options: ImportCodexCliTokensOptions): string {
  const configured = options.codexHome ?? process.env.CODEX_HOME;

  if (configured !== undefined && configured.trim().length > 0) {
    return resolve(configured);
  }

  return join(homedir(), ".codex");
}
