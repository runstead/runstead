import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
  CODEX_PROVIDER_ID
} from "./codex-auth-constants.js";
import {
  codexAuthStateToJson,
  codexModelsFromEnvironment,
  isRecord,
  normalizeCodexAuthState,
  parseCodexAuthState,
  parseCodexCliTokens,
  parseCodexModelsPayload,
  parseTokenResponsePayload,
  resolveCodexBaseUrl,
  toInteger,
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

async function requestCodexDeviceCode(options: {
  fetch: FetchLike;
  issuer: string;
}): Promise<CodexDeviceCode> {
  const response = await options.fetch(
    `${options.issuer}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Codex device-code request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as unknown;

  if (!isRecord(payload)) {
    throw new Error("Codex device-code response was not an object");
  }

  const userCode = payload.user_code;
  const deviceAuthId = payload.device_auth_id;
  const interval = payload.interval;

  if (typeof userCode !== "string" || userCode.trim().length === 0) {
    throw new Error("Codex device-code response is missing user_code");
  }

  if (typeof deviceAuthId !== "string" || deviceAuthId.trim().length === 0) {
    throw new Error("Codex device-code response is missing device_auth_id");
  }

  return {
    userCode: userCode.trim(),
    deviceAuthId: deviceAuthId.trim(),
    verificationUrl: `${options.issuer}/codex/device`,
    pollIntervalMs: Math.max(3, toInteger(interval, 5)) * 1000
  };
}

async function pollCodexDeviceAuthorization(options: {
  fetch: FetchLike;
  issuer: string;
  deviceCode: CodexDeviceCode;
  timeoutMs: number;
}): Promise<{ authorizationCode: string; codeVerifier: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    await sleep(options.deviceCode.pollIntervalMs);

    const response = await options.fetch(
      `${options.issuer}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          device_auth_id: options.deviceCode.deviceAuthId,
          user_code: options.deviceCode.userCode
        })
      }
    );

    if (response.status === 403 || response.status === 404) {
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `Codex device-code polling failed with status ${response.status}`
      );
    }

    const payload = (await response.json()) as unknown;

    if (!isRecord(payload)) {
      throw new Error("Codex device-code polling response was not an object");
    }

    const authorizationCode = payload.authorization_code;
    const codeVerifier = payload.code_verifier;

    if (
      typeof authorizationCode !== "string" ||
      authorizationCode.trim().length === 0 ||
      typeof codeVerifier !== "string" ||
      codeVerifier.trim().length === 0
    ) {
      throw new Error(
        "Codex device-code polling response is missing authorization_code or code_verifier"
      );
    }

    return {
      authorizationCode: authorizationCode.trim(),
      codeVerifier: codeVerifier.trim()
    };
  }

  throw new Error("Codex device-code login timed out");
}

async function exchangeCodexAuthorizationCode(options: {
  fetch: FetchLike;
  tokenUrl: string;
  issuer: string;
  authorizationCode: string;
  codeVerifier: string;
}): Promise<CodexAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.authorizationCode,
    redirect_uri: `${options.issuer}/deviceauth/callback`,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: options.codeVerifier
  });
  const response = await options.fetch(options.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Codex token exchange failed with status ${response.status}`);
  }

  return parseTokenResponsePayload(await response.json(), "Codex token exchange");
}

async function refreshCodexAuthTokens(options: {
  fetch: FetchLike;
  tokens: CodexAuthTokens;
  now?: Date;
}): Promise<{ tokens: CodexAuthTokens; lastRefresh: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: options.tokens.refreshToken,
    client_id: CODEX_OAUTH_CLIENT_ID
  });
  const response = await options.fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Codex token refresh failed with status ${response.status}`);
  }

  const refreshed = parseTokenResponsePayload(
    await response.json(),
    "Codex token refresh"
  );

  return {
    tokens: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || options.tokens.refreshToken
    },
    lastRefresh: (options.now ?? new Date()).toISOString()
  };
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
