import { describe, expect, it } from "vitest";

import {
  evaluateRunsteadConnectorSyncState,
  formatRunsteadConnectorSyncVerdict
} from "./connector-sync-state.js";

describe("connector sync state", () => {
  it("reports executable connectors as due when credentials exist and no sync has completed", () => {
    const verdict = evaluateRunsteadConnectorSyncState({
      connector: "docs",
      env: {
        DOCS_API_TOKEN: "token"
      },
      now: new Date("2026-05-30T00:00:00.000Z")
    });

    expect(verdict).toMatchObject({
      connector: "docs",
      status: "due",
      mode: "scheduled",
      missingCredentialEnv: []
    });
    expect(formatRunsteadConnectorSyncVerdict(verdict)).toContain("Next sync: now");
  });

  it("blocks executable sync when credentials are missing", () => {
    expect(
      evaluateRunsteadConnectorSyncState({
        connector: "github",
        env: {},
        now: new Date("2026-05-30T00:00:00.000Z")
      })
    ).toMatchObject({
      status: "blocked_credentials",
      mode: "webhook",
      missingCredentialEnv: ["GITHUB_TOKEN"]
    });
  });

  it("keeps catalog-only sync contracts visible", () => {
    expect(
      evaluateRunsteadConnectorSyncState({
        connector: "web",
        now: new Date("2026-05-30T00:00:00.000Z")
      })
    ).toMatchObject({
      connector: "web",
      status: "contract_only",
      mode: "scheduled"
    });
  });

  it("computes fresh and due windows from cursor state", () => {
    const fresh = evaluateRunsteadConnectorSyncState({
      connector: "posthog",
      env: {
        POSTHOG_API_KEY: "token"
      },
      now: new Date("2026-05-30T12:00:00.000Z"),
      state: {
        connector: "posthog",
        enabled: true,
        profile: "product:runstead",
        cursor: {
          kind: "insight_id",
          value: "activation",
          updatedAt: "2026-05-30T00:00:00.000Z"
        },
        lastCompletedAt: "2026-05-30T00:00:00.000Z"
      }
    });
    const due = evaluateRunsteadConnectorSyncState({
      connector: "posthog",
      env: {
        POSTHOG_API_KEY: "token"
      },
      now: new Date("2026-05-31T01:00:00.000Z"),
      state: {
        connector: "posthog",
        enabled: true,
        lastCompletedAt: "2026-05-30T00:00:00.000Z"
      }
    });

    expect(fresh).toMatchObject({
      status: "fresh",
      profile: "product:runstead",
      cursor: {
        kind: "insight_id",
        value: "activation"
      },
      nextSyncAt: "2026-05-31T00:00:00.000Z"
    });
    expect(due).toMatchObject({
      status: "due",
      nextSyncAt: "2026-05-31T00:00:00.000Z"
    });
  });

  it("reports running, failed, and disabled states before due checks", () => {
    expect(
      evaluateRunsteadConnectorSyncState({
        connector: "docs",
        env: {
          DOCS_API_TOKEN: "token"
        },
        state: {
          connector: "docs",
          enabled: true,
          runningSince: "2026-05-30T00:00:00.000Z"
        }
      }).status
    ).toBe("running");
    expect(
      evaluateRunsteadConnectorSyncState({
        connector: "docs",
        env: {
          DOCS_API_TOKEN: "token"
        },
        state: {
          connector: "docs",
          enabled: true,
          lastError: "provider timeout"
        }
      }).status
    ).toBe("failed");
    expect(
      evaluateRunsteadConnectorSyncState({
        connector: "docs",
        state: {
          connector: "docs",
          enabled: false
        }
      }).status
    ).toBe("disabled");
  });
});
