import { describe, expect, it } from "vitest";

import {
  collectRuntimeSourceProviderPayload,
  parseRuntimeSourceConnectorResponseJson,
  runtimeSourceProviderAuthHeaders
} from "./source-provider.js";

describe("source provider runtime", () => {
  it("redacts provider secrets while parsing JSON responses", () => {
    const result = parseRuntimeSourceConnectorResponseJson(
      JSON.stringify({
        token: "secret-token",
        nested: {
          message: "Bearer secret-token"
        }
      }),
      { secrets: ["secret-token"] }
    );

    expect(result).toEqual({
      payload: {
        token: "[redacted]",
        nested: {
          message: "Bearer [redacted]"
        }
      }
    });
  });

  it("returns bounded redacted excerpts for invalid connector JSON", () => {
    const result = parseRuntimeSourceConnectorResponseJson("secret-token", {
      secrets: ["secret-token"]
    });

    expect(result.payload).toEqual({});
    expect(result.parseError).toBeTruthy();
    expect(result.responseExcerpt).toBe("[redacted]");
  });

  it("builds provider auth headers without CLI coupling", () => {
    expect(
      runtimeSourceProviderAuthHeaders(
        { connector: "github_actions", provider: "github" },
        "ghp_token"
      )
    ).toEqual({
      Authorization: "Bearer ghp_token",
      Accept: "application/vnd.github+json"
    });
    expect(
      runtimeSourceProviderAuthHeaders(
        { connector: "posthog", provider: "posthog" },
        "ph_token"
      )
    ).toEqual({
      Authorization: "Bearer ph_token"
    });
    expect(
      runtimeSourceProviderAuthHeaders(
        { connector: "gitlab_ci", provider: "gitlab" },
        "gl_token"
      )
    ).toEqual({
      "PRIVATE-TOKEN": "gl_token"
    });
  });

  it("classifies external provider payloads into readiness collection states", () => {
    expect(
      collectRuntimeSourceProviderPayload({
        adapter: { connector: "github_actions", provider: "github" },
        definition: { displayName: "GitHub Actions" },
        responseStatus: 200,
        responseOk: true,
        responsePayload: {
          workflow: "CI",
          conclusion: "success",
          headSha: "abc123",
          runId: 42
        }
      })
    ).toMatchObject({
      status: "passed",
      summary: "GitHub Actions workflow CI success"
    });
    expect(
      collectRuntimeSourceProviderPayload({
        adapter: { connector: "gitlab_ci", provider: "gitlab" },
        definition: { displayName: "GitLab CI" },
        responseStatus: 200,
        responseOk: true,
        responsePayload: {
          id: 42,
          status: "success",
          sha: "abc123"
        }
      })
    ).toMatchObject({
      status: "passed",
      summary: "GitLab CI 42 status success"
    });
    expect(
      collectRuntimeSourceProviderPayload({
        adapter: { connector: "slack", provider: "slack" },
        definition: { displayName: "Slack" },
        responseStatus: 200,
        responseOk: true,
        responsePayload: {
          channel: "eng",
          threadTs: "123.456"
        }
      })
    ).toMatchObject({
      status: "unknown",
      summary: "Slack adapter has no parser"
    });
    expect(
      collectRuntimeSourceProviderPayload({
        adapter: { connector: "vercel", provider: "vercel" },
        definition: { displayName: "Vercel" },
        responseStatus: 200,
        responseOk: true,
        responsePayload: {
          readyState: "READY",
          deploymentUrl: "https://todo.example",
          commitSha: "abc123"
        }
      })
    ).toMatchObject({
      status: "passed",
      payload: {
        connector: "vercel",
        deploymentUrl: "https://todo.example"
      }
    });
    expect(
      collectRuntimeSourceProviderPayload({
        adapter: { connector: "posthog", provider: "posthog" },
        definition: { displayName: "PostHog" },
        responseStatus: 200,
        responseOk: true,
        responsePayload: {
          metric: "activation",
          value: 8,
          threshold: 10,
          realUserData: true
        }
      })
    ).toMatchObject({
      status: "failed",
      summary: "PostHog metric activation value 8"
    });
  });
});
