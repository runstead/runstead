import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatStartupGateFixtureTestSummary,
  testStartupGateFixtures
} from "./startup-gate-test.js";

const goldenFixtureDir = fileURLToPath(
  new URL(
    "../../domain-packs/packs/ai-native-startup/fixtures/readiness-gates/",
    import.meta.url
  )
);

describe("startup gate fixture replay", () => {
  it("replays golden startup readiness gate fixtures", async () => {
    const summary = await testStartupGateFixtures({
      fixturePath: goldenFixtureDir
    });

    expect(summary).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0
    });
  });

  it("returns explicit mismatches for failing fixtures", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runstead-gate-fixture-"));
    const fixturePath = join(workspace, "local-ready.yaml");

    try {
      await writeFile(
        fixturePath,
        `schemaVersion: 1
input:
  target: local
  phases:
    - id: verifiers
      title: Run verifiers
      status: passed
      evidenceIds: [ev_test]
  evidenceTiers: [local_command]
  evidenceTypes: [command_output]
expect:
  verdict: local_launch_blocked
  canLaunch: false
`,
        "utf8"
      );

      const summary = await testStartupGateFixtures({ fixturePath });
      const formatted = formatStartupGateFixtureTestSummary(summary);

      expect(summary).toMatchObject({
        total: 1,
        passed: 0,
        failed: 1
      });
      expect(summary.results[0]?.errors).toEqual([
        "requested target expected verdict local_launch_blocked, got local_launch_ready",
        "requested target expected canLaunch false, got true"
      ]);
      expect(formatted).toContain("FAIL local-ready.yaml");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
