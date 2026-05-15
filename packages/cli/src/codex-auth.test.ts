import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODEX_OAUTH_TOKEN_URL,
  CODEX_PROVIDER_ID,
  codexAuthStorePath,
  codexBackendHeaders,
  codexModelCachePath,
  formatCodexAuthStatus,
  formatCodexModels,
  getCodexAuthStatus,
  importCodexCliTokens,
  listCodexModels,
  resolveCodexRuntimeCredentials,
  saveCodexAuthState
} from "./codex-auth.js";

describe("codex auth store", () => {
  it("stores Codex tokens in a Runstead-owned auth file without printing them", async () => {
    const runsteadHome = await mkdtemp(join(tmpdir(), "runstead-codex-auth-"));
    const accessToken = jwtWithExp(1_900_000_000);
    const refreshToken = "refresh-secret";

    try {
      const saved = await saveCodexAuthState(
        {
          provider: CODEX_PROVIDER_ID,
          authMode: "chatgpt",
          source: "device-code",
          baseUrl: "https://chatgpt.com/backend-api/codex/",
          tokens: {
            accessToken,
            refreshToken
          },
          lastRefresh: "2026-05-16T00:00:00.000Z"
        },
        { runsteadHome }
      );
      const mode = (await stat(saved.authPath)).mode & 0o777;
      const status = await getCodexAuthStatus({ runsteadHome });
      const formatted = formatCodexAuthStatus(status);
      const rawStore = await readFile(saved.authPath, "utf8");

      expect(saved.authPath).toBe(codexAuthStorePath({ runsteadHome }));
      expect(mode).toBe(0o600);
      expect(rawStore).toContain(accessToken);
      expect(rawStore).toContain(refreshToken);
      expect(status).toMatchObject({
        loggedIn: true,
        baseUrl: "https://chatgpt.com/backend-api/codex",
        source: "device-code",
        hasRefreshToken: true,
        accessTokenExpired: false
      });
      expect(formatted).not.toContain(accessToken);
      expect(formatted).not.toContain(refreshToken);
    } finally {
      await rm(runsteadHome, { force: true, recursive: true });
    }
  });

  it("imports Codex CLI tokens only when explicitly requested by the caller", async () => {
    const runsteadHome = await mkdtemp(join(tmpdir(), "runstead-codex-import-"));
    const codexHome = await mkdtemp(join(tmpdir(), "runstead-codex-cli-"));
    const accessToken = jwtWithExp(1_900_000_000);

    try {
      await mkdir(codexHome, { recursive: true });
      await writeFile(
        join(codexHome, "auth.json"),
        JSON.stringify({
          tokens: {
            access_token: accessToken,
            refresh_token: "cli-refresh"
          }
        })
      );

      const imported = await importCodexCliTokens({
        runsteadHome,
        codexHome,
        now: new Date("2026-05-16T00:00:00.000Z")
      });
      const status = await getCodexAuthStatus({ runsteadHome });

      expect(imported?.state.source).toBe("codex-cli-import");
      expect(status.source).toBe("codex-cli-import");
    } finally {
      await rm(runsteadHome, { force: true, recursive: true });
      await rm(codexHome, { force: true, recursive: true });
    }
  });

  it("refreshes expiring tokens under the auth store lock", async () => {
    const runsteadHome = await mkdtemp(join(tmpdir(), "runstead-codex-refresh-"));
    const refreshedAccessToken = jwtWithExp(1_900_000_000);
    const bodies: string[] = [];

    try {
      await saveCodexAuthState(
        {
          provider: CODEX_PROVIDER_ID,
          authMode: "chatgpt",
          source: "device-code",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          tokens: {
            accessToken: jwtWithExp(1_700_000_000),
            refreshToken: "old-refresh"
          },
          lastRefresh: "2026-05-16T00:00:00.000Z"
        },
        { runsteadHome }
      );

      const credentials = await resolveCodexRuntimeCredentials({
        runsteadHome,
        now: new Date("2026-05-16T00:00:00.000Z"),
        fetch: (input, init) => {
          expect(String(input)).toBe(CODEX_OAUTH_TOKEN_URL);
          bodies.push(requireUrlSearchParamsBody(init).toString());

          return Promise.resolve(
            jsonResponse({
              access_token: refreshedAccessToken,
              refresh_token: "new-refresh"
            })
          );
        }
      });

      const status = await getCodexAuthStatus({ runsteadHome });
      const stored = JSON.parse(
        await readFile(codexAuthStorePath({ runsteadHome }), "utf8")
      ) as {
        providers: Record<string, { tokens: Record<string, string> }>;
      };

      expect(credentials.accessToken).toBe(refreshedAccessToken);
      expect(bodies[0]).toContain("refresh_token=old-refresh");
      expect(stored.providers[CODEX_PROVIDER_ID]?.tokens.refresh_token).toBe(
        "new-refresh"
      );
      expect(status.accessTokenExpired).toBe(false);
    } finally {
      await rm(runsteadHome, { force: true, recursive: true });
    }
  });

  it("lists Codex models through the authenticated backend without exposing tokens", async () => {
    const runsteadHome = await mkdtemp(join(tmpdir(), "runstead-codex-models-"));
    const accessToken = jwtWithExp(1_900_000_000, "acct-models-1");

    try {
      await saveCodexAuthState(
        {
          provider: CODEX_PROVIDER_ID,
          authMode: "chatgpt",
          source: "device-code",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          tokens: {
            accessToken,
            refreshToken: "refresh-secret"
          },
          lastRefresh: "2026-05-16T00:00:00.000Z"
        },
        { runsteadHome }
      );

      const models = await listCodexModels({
        runsteadHome,
        now: new Date("2026-05-16T00:00:00.000Z"),
        fetch: (input, init) => {
          expect(String(input)).toBe(
            "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0"
          );
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            `Bearer ${accessToken}`
          );
          expect((init?.headers as Record<string, string>)["ChatGPT-Account-ID"]).toBe(
            "acct-models-1"
          );
          expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(
            /^codex_cli_rs\//
          );
          expect((init?.headers as Record<string, string>).originator).toBe(
            "codex_cli_rs"
          );

          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  slug: "gpt-5.1-codex",
                  context_window: 272000
                }
              ]
            })
          );
        }
      });
      const cached = JSON.parse(
        await readFile(codexModelCachePath({ runsteadHome }), "utf8")
      ) as { models: { id: string }[] };
      const cachedFallback = await listCodexModels({
        runsteadHome,
        fetch: () => Promise.resolve(jsonResponse({ error: "down" }, 503))
      });
      const formatted = formatCodexModels(models);

      expect(models).toEqual([
        expect.objectContaining({
          id: "gpt-5.1-codex",
          contextWindow: 272000
        })
      ]);
      expect(cached.models[0]?.id).toBe("gpt-5.1-codex");
      expect(cachedFallback[0]?.id).toBe("gpt-5.1-codex");
      expect(formatted).toContain("gpt-5.1-codex");
      expect(formatted).not.toContain(accessToken);
    } finally {
      await rm(runsteadHome, { force: true, recursive: true });
    }
  });

  it("builds Codex backend headers from the OAuth JWT account claim", () => {
    const validHeaders = codexBackendHeaders(
      jwtWithExp(1_900_000_000, "acct-headers-1")
    );
    const malformedHeaders = codexBackendHeaders("not-a-jwt");

    expect(validHeaders["ChatGPT-Account-ID"]).toBe("acct-headers-1");
    expect(validHeaders["User-Agent"]).toMatch(/^codex_cli_rs\//);
    expect(validHeaders.originator).toBe("codex_cli_rs");
    expect(malformedHeaders["User-Agent"]).toMatch(/^codex_cli_rs\//);
    expect(malformedHeaders.originator).toBe("codex_cli_rs");
    expect(malformedHeaders).not.toHaveProperty("ChatGPT-Account-ID");
  });

  it("falls back to configured Codex model ids when live discovery and cache miss", async () => {
    const runsteadHome = await mkdtemp(join(tmpdir(), "runstead-codex-env-models-"));
    const previous = process.env.RUNSTEAD_CODEX_MODELS;

    try {
      process.env.RUNSTEAD_CODEX_MODELS = "codex-a, codex-b";
      await saveCodexAuthState(
        {
          provider: CODEX_PROVIDER_ID,
          authMode: "chatgpt",
          source: "device-code",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          tokens: {
            accessToken: jwtWithExp(1_900_000_000),
            refreshToken: "refresh-secret"
          },
          lastRefresh: "2026-05-16T00:00:00.000Z"
        },
        { runsteadHome }
      );

      const models = await listCodexModels({
        runsteadHome,
        fetch: () => Promise.resolve(jsonResponse({ error: "down" }, 503))
      });

      expect(models.map((model) => model.id)).toEqual(["codex-a", "codex-b"]);
    } finally {
      if (previous === undefined) {
        delete process.env.RUNSTEAD_CODEX_MODELS;
      } else {
        process.env.RUNSTEAD_CODEX_MODELS = previous;
      }
      await rm(runsteadHome, { force: true, recursive: true });
    }
  });
});

function jwtWithExp(exp: number, accountId?: string): string {
  const claims: Record<string, unknown> = { exp };

  if (accountId !== undefined) {
    claims["https://api.openai.com/auth"] = {
      chatgpt_account_id: accountId
    };
  }

  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify(claims)),
    "signature"
  ].join(".");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function requireUrlSearchParamsBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;

  if (!(body instanceof URLSearchParams)) {
    throw new Error("Expected URLSearchParams request body");
  }

  return body;
}
