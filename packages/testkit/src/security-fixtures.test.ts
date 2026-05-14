import { describe, expect, it } from "vitest";

import {
  loadSecurityFixture,
  loadSecurityFixtures,
  REQUIRED_SECURITY_FIXTURE_IDS
} from "./security-fixtures.js";

describe("security fixtures", () => {
  it("loads all required fixtures in deterministic order", async () => {
    const fixtures = await loadSecurityFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      ...REQUIRED_SECURITY_FIXTURE_IDS
    ]);
  });

  for (const fixtureId of REQUIRED_SECURITY_FIXTURE_IDS) {
    it(`defines ${fixtureId}`, async () => {
      const fixture = await loadSecurityFixture(fixtureId);

      expect(fixture.manifest.id).toBe(fixtureId);
      expect(fixture.manifest.threat).toMatch(/^[a-z_]+$/);
      expect(fixture.manifest.expectedControls).toContain("treat_as_untrusted");
      expect(fixture.manifest.mustNot.length).toBeGreaterThan(0);
      expect(fixture.input.length).toBeGreaterThan(0);
    });
  }

  it("rejects unknown security fixture ids", async () => {
    await expect(loadSecurityFixture("missing-fixture")).rejects.toThrow(
      "Unknown security fixture"
    );
  });
});
