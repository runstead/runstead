import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initStartup } from "./startup-automation.js";
import {
  createStartupReadinessClient,
  ingestStartupWebhookEvidence,
  startupApiSnapshot
} from "./startup-sdk.js";

describe("startup SDK", () => {
  it("exposes schema-versioned snapshots and webhook evidence ingestion", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-startup-sdk-"));

    try {
      await initStartup({
        cwd: workspace,
        stage: "mvp",
        now: new Date("2026-05-14T10:00:00.000Z")
      });

      const webhook = await ingestStartupWebhookEvidence({
        cwd: workspace,
        connector: "github_actions",
        payload: {
          workflow: "ci",
          conclusion: "success"
        },
        trustLevel: "authoritative",
        now: new Date("2026-05-14T10:05:00.000Z")
      });
      const snapshot = await startupApiSnapshot({
        cwd: workspace,
        now: new Date("2026-05-14T10:10:00.000Z")
      });
      const client = createStartupReadinessClient({ cwd: workspace });
      const clientSnapshot = await client.snapshot({
        now: new Date("2026-05-14T10:15:00.000Z")
      });

      expect(webhook.connector).toBe("github_actions");
      expect(webhook.evidence.type).toBe("startup_repo_readiness");
      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        contracts: {
          evidencePrefix: "startup_",
          artifactSchemaVersion: 1,
          webhookIngest: "startup.source.record"
        }
      });
      expect(snapshot.status.evidence.total).toBeGreaterThan(0);
      expect(clientSnapshot.schemaVersion).toBe(1);
      expect(await client.checkGate("mvp")).toMatchObject({ stage: "mvp" });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
