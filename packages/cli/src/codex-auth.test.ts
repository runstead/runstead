import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODEX_OAUTH_TOKEN_URL,
  CODEX_PROVIDER_ID,
  codexAuthStorePath,
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
        fetch: async (input, init) => {
          expect(String(input)).toBe(CODEX_OAUTH_TOKEN_URL);
          bodies.push(String(init?.body));

          return jsonResponse({
            access_token: refreshedAccessToken,
            refresh_token: "new-refresh"
          });
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
    const accessToken = jwtWithExp(1_900_000_000);

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
        fetch: async (input, init) => {
          expect(String(input)).toBe(
            "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0"
          );
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            `Bearer ${accessToken}`
          );

          return jsonResponse({
            models: [
              {
                slug: "gpt-5.1-codex",
                context_window: 272000
              }
            ]
          });
        }
      });
      const formatted = formatCodexModels(models);

      expect(models).toEqual([
        expect.objectContaining({
          id: "gpt-5.1-codex",
          contextWindow: 272000
        })
      ]);
      expect(formatted).toContain("gpt-5.1-codex");
      expect(formatted).not.toContain(accessToken);
    } finally {
      await rm(runsteadHome, { force: true, recursive: true });
    }
  });
});

function jwtWithExp(exp: number): string {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify({ exp })),
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
