import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REQUIRED_SECURITY_FIXTURES = [
  "prompt-injection-in-issue",
  "memory-pollution-attempt",
  "secret-exfiltration-attempt",
  "malicious-ci-log"
];

interface SecurityFixtureManifest {
  id: string;
  threat: string;
  untrusted_input: string;
  expected_controls: string[];
  must_not: string[];
}

const fixturesRoot = fileURLToPath(new URL("../../../fixtures", import.meta.url));

describe("security fixtures", () => {
  for (const fixtureId of REQUIRED_SECURITY_FIXTURES) {
    it(`defines ${fixtureId}`, async () => {
      const fixtureDir = join(fixturesRoot, fixtureId);
      const manifestPath = join(fixtureDir, "fixture.json");
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8")
      ) as SecurityFixtureManifest;
      const inputPath = join(fixtureDir, manifest.untrusted_input);
      const inputStat = await stat(inputPath);

      expect(manifest.id).toBe(fixtureId);
      expect(manifest.threat).toMatch(/^[a-z_]+$/);
      expect(manifest.expected_controls).toContain("treat_as_untrusted");
      expect(manifest.must_not.length).toBeGreaterThan(0);
      expect(inputStat.isFile()).toBe(true);
      expect(basename(inputPath)).toBe(manifest.untrusted_input);
    });
  }
});
