import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startupOnboard } from "./startup-founder-flow.js";
import {
  recordStartupSourceEvidence,
  STARTUP_SOURCE_CONNECTORS
} from "./startup-source-connectors.js";

describe("startup source connectors", () => {
  it("records external source evidence with freshness, hash, and trust metadata", async () => {
    const workspace = join(tmpdir(), `runstead-startup-source-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "source-fixture", private: true }, null, 2)}\n`,
        "utf8"
      );
      await startupOnboard({
        cwd: workspace,
        now: new Date("2026-05-14T00:00:00.000Z")
      });

      const result = await recordStartupSourceEvidence({
        cwd: workspace,
        connector: "github_actions",
        uri: "https://github.com/acme/app/actions/runs/123",
        summary: "Latest launch verifier workflow passed",
        status: "passed",
        capturedAt: "2026-05-14T00:10:00.000Z",
        freshnessDays: 3,
        sourceHash: "sha256:abc123",
        trustLevel: "authoritative",
        payload: JSON.stringify({
          runId: 123,
          conclusion: "success"
        }),
        now: new Date("2026-05-14T00:15:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        evidenceType: string;
        sources: {
          kind: string;
          uri: string;
          capturedAt: string;
          freshnessDays: number;
          hash: string;
          trustLevel: string;
          provenance: {
            connector: string;
            captureMode: string;
          };
        }[];
        content: string;
      };
      const content = JSON.parse(artifact.content) as {
        connector: string;
        status: string;
        payload: {
          runId: number;
          conclusion: string;
        };
      };

      expect(STARTUP_SOURCE_CONNECTORS).toContain("github_actions");
      expect(result.evidence.type).toBe("startup_repo_readiness");
      expect(result.connector).toBe("github_actions");
      expect(artifact.evidenceType).toBe("repo_readiness");
      expect(artifact.sources[0]).toMatchObject({
        kind: "github_actions",
        uri: "https://github.com/acme/app/actions/runs/123",
        capturedAt: "2026-05-14T00:10:00.000Z",
        freshnessDays: 3,
        hash: "sha256:abc123",
        trustLevel: "authoritative",
        provenance: {
          connector: "github_actions",
          captureMode: "connector_ingest"
        }
      });
      expect(content).toMatchObject({
        connector: "github_actions",
        status: "passed",
        payload: {
          runId: 123,
          conclusion: "success"
        }
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects connector payloads that are not JSON objects", async () => {
    await expect(
      recordStartupSourceEvidence({
        cwd: process.cwd(),
        connector: "analytics",
        uri: "posthog:activation",
        summary: "Bad payload",
        payload: "[1,2,3]"
      })
    ).rejects.toThrow("--payload must be a JSON object");
  });
});
