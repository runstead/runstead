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

export const CODEX_PROVIDER_ID = "openai-codex";
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_AUTH_REFRESH_SKEW_SECONDS = 120;

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

export {
  codexAuthStorePath,
  codexModelCachePath,
  resolveRunsteadHome,
  type CodexAuthStoreOptions
} from "./codex-auth-store.js";

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

export function formatCodexAuthStatus(status: CodexAuthStatus): string {
  if (!status.loggedIn) {
    return [
      "Codex Direct: not logged in",
      `Auth store: ${status.authPath}`,
      "Run `runstead codex login` to authenticate."
    ].join("\n");
  }

  return [
    "Codex Direct: logged in",
    `Provider: ${status.provider}`,
    `Base URL: ${status.baseUrl ?? DEFAULT_CODEX_BASE_URL}`,
    `Source: ${status.source ?? "unknown"}`,
    `Auth mode: ${status.authMode ?? "unknown"}`,
    `Refresh token: ${status.hasRefreshToken === true ? "present" : "missing"}`,
    ...(status.lastRefresh === undefined
      ? []
      : [`Last refresh: ${status.lastRefresh}`]),
    ...(status.accessTokenExpiresAt === undefined
      ? []
      : [`Access token expires: ${status.accessTokenExpiresAt}`]),
    `Access token expired: ${status.accessTokenExpired === true ? "yes" : "no"}`,
    `Auth store: ${status.authPath}`
  ].join("\n");
}

export function formatCodexModels(models: CodexModel[]): string {
  if (models.length === 0) {
    return "Codex models: none returned";
  }

  return [
    "Codex models:",
    ...models.map((model) =>
      model.contextWindow === undefined
        ? `  ${model.id}`
        : `  ${model.id} (${model.contextWindow} context)`
    )
  ].join("\n");
}

export function isCodexAccessTokenExpiring(
  accessToken: string,
  skewSeconds: number,
  now = new Date()
): boolean {
  const exp = codexAccessTokenExpUnixSeconds(accessToken);

  if (exp === undefined) {
    return false;
  }

  return exp <= now.getTime() / 1000 + Math.max(0, skewSeconds);
}

export function codexAccessTokenExpiresAt(accessToken: string): string | undefined {
  const exp = codexAccessTokenExpUnixSeconds(accessToken);

  if (exp === undefined) {
    return undefined;
  }

  return new Date(exp * 1000).toISOString();
}

export function codexBackendHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "codex_cli_rs/0.0.0 (Runstead)",
    originator: "codex_cli_rs"
  };
  const accountId = codexChatGptAccountId(accessToken);

  if (accountId !== undefined) {
    headers["ChatGPT-Account-ID"] = accountId;
  }

  return headers;
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

function parseCodexAuthState(raw: unknown): CodexAuthState {
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

function codexAuthStateToJson(state: CodexAuthState): CodexAuthStateJson {
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

function normalizeCodexAuthState(state: CodexAuthState): CodexAuthState {
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

function parseCodexCliTokens(raw: unknown): CodexAuthTokens | undefined {
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

function parseTokenResponsePayload(payload: unknown, label: string): CodexAuthTokens {
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

function parseCodexModelsPayload(payload: unknown): CodexModel[] {
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

function resolveCodexCliHome(options: ImportCodexCliTokensOptions): string {
  const configured = options.codexHome ?? process.env.CODEX_HOME;

  if (configured !== undefined && configured.trim().length > 0) {
    return resolve(configured);
  }

  return join(homedir(), ".codex");
}

function resolveCodexBaseUrl(value: string | undefined): string {
  return trimTrailingSlash(
    value ?? process.env.RUNSTEAD_CODEX_BASE_URL ?? DEFAULT_CODEX_BASE_URL
  );
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function codexAccessTokenExpUnixSeconds(accessToken: string): number | undefined {
  const parts = accessToken.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1] ?? "")) as unknown;

    if (!isRecord(payload) || typeof payload.exp !== "number") {
      return undefined;
    }

    return payload.exp;
  } catch {
    return undefined;
  }
}

function codexChatGptAccountId(accessToken: string): string | undefined {
  const parts = accessToken.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1] ?? "")) as unknown;

    if (!isRecord(payload)) {
      return undefined;
    }

    const authClaims = payload["https://api.openai.com/auth"];

    if (!isRecord(authClaims) || typeof authClaims.chatgpt_account_id !== "string") {
      return undefined;
    }

    const accountId = authClaims.chatgpt_account_id.trim();

    return accountId.length === 0 ? undefined : accountId;
  } catch {
    return undefined;
  }
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );

  return Buffer.from(padded, "base64").toString("utf8");
}

function toInteger(value: unknown, fallback: number): number {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
