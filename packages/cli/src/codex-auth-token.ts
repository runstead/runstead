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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
