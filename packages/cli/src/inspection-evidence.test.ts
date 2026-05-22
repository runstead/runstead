import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";
import { describe, expect, it } from "vitest";

import { storeRepoInspectionEvidence } from "./inspection-evidence.js";

describe("storeRepoInspectionEvidence", () => {
  it("writes a repo inspection artifact and stores evidence in state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-inspection-"));
    const runsteadRoot = join(workspace, ".runstead");
    const workflowsDir = join(workspace, ".github", "workflows");
    const database = openRunsteadDatabase(join(runsteadRoot, "state.db"));

    try {
      await mkdir(workflowsDir, { recursive: true });
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@11.1.1",
          scripts: {
            test: "vitest run",
            lint: "eslint src"
          }
        }),
        "utf8"
      );
      await writeFile(join(workflowsDir, "verify.yml"), "name: verify\n", "utf8");

      const result = await storeRepoInspectionEvidence({
        cwd: workspace,
        runsteadRoot,
        database,
        now: new Date("2026-05-14T00:00:00.000Z")
      });
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
        packageManager: { packageManager?: string };
        commands: { test: { command?: string }; lint: { command?: string } };
        ci: { providers: { provider: string }[] };
      };
      const manifest = JSON.parse(
        await readFile(result.artifactManifestPath, "utf8")
      ) as {
        artifactUri: string;
        sha256: string;
        metadata: { evidenceId: string; evidenceType: string };
      };
      const evidence = database
        .prepare(
          `
          SELECT id, type, subject_type, uri, hash, summary, created_at
          FROM evidence
        `
        )
        .get() as {
        id: string;
        type: string;
        subject_type: string;
        uri: string;
        hash: string;
        summary: string;
        created_at: string;
      };
      const event = database
        .prepare(
          `
          SELECT event_id, type, aggregate_type, aggregate_id
          FROM events
        `
        )
        .get() as {
        event_id: string;
        type: string;
        aggregate_type: string;
        aggregate_id: string;
      };

      expect(artifact.packageManager.packageManager).toBe("pnpm");
      expect(artifact.commands.test.command).toBe("pnpm test");
      expect(artifact.commands.lint.command).toBe("pnpm run lint");
      expect(artifact.ci.providers).toMatchObject([
        {
          provider: "github_actions"
        }
      ]);
      expect(evidence).toMatchObject({
        id: result.evidence.id,
        type: "repo_inspection",
        subject_type: "repository",
        uri: result.evidence.uri,
        hash: result.evidence.hash,
        summary: result.evidence.summary,
        created_at: "2026-05-14T00:00:00.000Z"
      });
      expect(event).toMatchObject({
        event_id: result.event.eventId,
        type: "evidence.recorded",
        aggregate_type: "evidence",
        aggregate_id: result.evidence.id
      });
      expect(manifest).toMatchObject({
        artifactUri: result.evidence.uri,
        sha256: result.evidence.hash,
        metadata: {
          evidenceId: result.evidence.id,
          evidenceType: "repo_inspection"
        }
      });
    } finally {
      database.close();
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
