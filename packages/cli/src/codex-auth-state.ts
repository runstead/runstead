import {
  codexAuthStorePath,
  readCodexAuthStore,
  writeCodexAuthStore,
  type CodexAuthStoreOptions
} from "./codex-auth-store.js";
import { CODEX_PROVIDER_ID } from "./codex-auth-constants.js";
import { codexAuthStateToJson, parseCodexAuthState } from "./codex-auth-parsers.js";
import {
  codexAccessTokenExpiresAt,
  isCodexAccessTokenExpiring
} from "./codex-auth-token.js";
import type { CodexAuthState, CodexAuthStatus } from "./codex-auth-types.js";

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
