import { describe, expect, it } from "vitest";

import { resolveStartupSourceCollectSource } from "./startup-source-provider-shortcuts.js";

describe("startup source provider shortcuts", () => {
  it("preserves explicit connector and source URI collection", () => {
    expect(
      resolveStartupSourceCollectSource({
        connector: "render",
        sourceUri: "https://api.render.com/v1/services/srv/deploys/dep"
      })
    ).toEqual({
      connector: "render",
      sourceUri: "https://api.render.com/v1/services/srv/deploys/dep"
    });
  });

  it("infers GitHub Actions collection from repo and run id", () => {
    expect(
      resolveStartupSourceCollectSource({
        githubRepo: "acme/todo",
        githubRunId: "123"
      })
    ).toEqual({
      connector: "github_actions",
      shortcut: "github_actions",
      sourceUri: "https://api.github.com/repos/acme/todo/actions/runs/123"
    });
  });

  it("builds Vercel deployment collection with optional team scope", () => {
    expect(
      resolveStartupSourceCollectSource({
        connector: "vercel",
        vercelDeployment: "todo-preview.vercel.app",
        vercelTeam: "team_123"
      })
    ).toEqual({
      connector: "vercel",
      shortcut: "vercel",
      sourceUri:
        "https://api.vercel.com/v13/deployments/todo-preview.vercel.app?teamId=team_123"
    });
  });

  it("builds Sentry release collection with optional project filter", () => {
    expect(
      resolveStartupSourceCollectSource({
        sentryOrg: "acme",
        sentryRelease: "todo@1.2.3",
        sentryProjectId: "42"
      })
    ).toEqual({
      connector: "sentry",
      shortcut: "sentry",
      sourceUri:
        "https://sentry.io/api/0/organizations/acme/releases/todo%401.2.3/?project_id=42"
    });
  });

  it("builds PostHog insight collection from environment and insight ids", () => {
    expect(
      resolveStartupSourceCollectSource({
        posthogEnvironment: "123",
        posthogInsight: "activation",
        posthogHost: "https://eu.posthog.com"
      })
    ).toEqual({
      connector: "posthog",
      shortcut: "posthog",
      sourceUri: "https://eu.posthog.com/api/environments/123/insights/activation/"
    });
  });

  it("rejects ambiguous or partial shortcut input", () => {
    expect(() =>
      resolveStartupSourceCollectSource({
        githubRepo: "acme/todo"
      })
    ).toThrow("--github-run-id is required");
    expect(() =>
      resolveStartupSourceCollectSource({
        connector: "posthog",
        sourceUri: "https://app.posthog.com/api/environments/1/insights/2/",
        posthogInsight: "2"
      })
    ).toThrow("--source-uri cannot be combined");
    expect(() =>
      resolveStartupSourceCollectSource({
        connector: "github_actions",
        vercelDeployment: "dpl_123"
      })
    ).toThrow("--connector github_actions cannot be combined with vercel");
  });
});
