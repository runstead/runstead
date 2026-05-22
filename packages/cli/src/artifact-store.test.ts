import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { writeJsonArtifactFile } from "./artifact-store.js";

describe("writeJsonArtifactFile", () => {
  it("writes artifacts atomically and records a companion manifest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-artifact-store-"));
    const artifactPath = join(workspace, "evidence", "artifact.json");

    try {
      const result = await writeJsonArtifactFile({
        artifactPath,
        value: {
          schemaVersion: 1,
          value: "launch evidence"
        },
        createdAt: "2026-05-23T00:00:00.000Z",
        metadata: {
          evidenceId: "ev_artifact_store_001"
        }
      });
      const artifactContents = await readFile(artifactPath, "utf8");
      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
        schemaVersion: number;
        artifactPath: string;
        artifactUri: string;
        contentType: string;
        sha256: string;
        sizeBytes: number;
        createdAt: string;
        metadata: { evidenceId: string };
      };
      const files = await readdir(join(workspace, "evidence"));

      expect(result.artifactUri).toBe(pathToFileURL(artifactPath).href);
      expect(artifactContents).toBe(result.contents);
      expect(result.sha256).toBe(
        createHash("sha256").update(artifactContents).digest("hex")
      );
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        artifactPath,
        artifactUri: result.artifactUri,
        contentType: "application/json",
        sha256: result.sha256,
        sizeBytes: Buffer.byteLength(artifactContents),
        createdAt: "2026-05-23T00:00:00.000Z",
        metadata: {
          evidenceId: "ev_artifact_store_001"
        }
      });
      expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
