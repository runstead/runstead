import { setTimeout as sleep } from "node:timers/promises";

import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL
} from "./codex-auth-constants.js";
import {
  isRecord,
  parseTokenResponsePayload,
  toInteger
} from "./codex-auth-parsers.js";
import type { CodexAuthTokens, CodexDeviceCode } from "./codex-auth.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function requestCodexDeviceCode(options: {
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

export async function pollCodexDeviceAuthorization(options: {
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

export async function exchangeCodexAuthorizationCode(options: {
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

export async function refreshCodexAuthTokens(options: {
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
