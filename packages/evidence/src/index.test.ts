import { describe, expect, it } from "vitest";

import {
  compareEvidenceQuality,
  defineEvidenceSource,
  evidenceTierRank
} from "./index.js";

describe("evidence quality contracts", () => {
  it("validates external evidence source metadata", () => {
    expect(
      defineEvidenceSource({
        kind: "github_actions",
        uri: "https://github.com/acme/app/actions/runs/1",
        capturedAt: "2026-05-23T00:00:00.000Z",
        freshnessDays: 7,
        trust: "authoritative"
      })
    ).toMatchObject({
      kind: "github_actions",
      trust: "authoritative"
    });
  });

  it("orders quality tiers from weakest to strongest", () => {
    expect(evidenceTierRank("none")).toBeLessThan(evidenceTierRank("local_artifact"));
    expect(
      compareEvidenceQuality("external_observed", "machine_verified")
    ).toBeGreaterThan(0);
  });
});
