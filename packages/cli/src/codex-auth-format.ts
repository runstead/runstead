import type { CodexAuthStatus, CodexModel } from "./codex-auth.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

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
