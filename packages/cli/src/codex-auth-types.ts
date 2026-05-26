import type { CODEX_PROVIDER_ID } from "./codex-auth-constants.js";
import type { CodexAuthStoreOptions } from "./codex-auth-store.js";

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

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
