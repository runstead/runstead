import { describe, expect, it } from "vitest";

import {
  parsedStartupReadinessArtifactContent,
  stagingDeploymentText,
  startupReadinessArtifactSources,
  startupReadinessEvidenceCodeFingerprintStale,
  startupReadinessEvidenceCurrentKey,
  startupReadinessEvidenceIsStale
} from "./readiness-evidence.js";

describe("readiness evidence runtime", () => {
  it("detects stale source freshness windows", () => {
    expect(
      startupReadinessEvidenceIsStale(
        {
          sources: [
            {
              uri: "https://example.test/run",
              capturedAt: "2026-05-01T00:00:00.000Z",
              freshnessDays: 7
            }
          ]
        },
        "2026-05-10T00:00:00.000Z"
      )
    ).toBe(true);
    expect(
      startupReadinessEvidenceIsStale(
        {
          sources: [
            {
              uri: "https://example.test/run",
              capturedAt: "2026-05-08T00:00:00.000Z",
              freshnessDays: 7
            }
          ]
        },
        "2026-05-10T00:00:00.000Z"
      )
    ).toBe(false);
  });

  it("detects stale code fingerprints", () => {
    expect(
      startupReadinessEvidenceCodeFingerprintStale(
        { codeState: { fingerprint: "old" } },
        "new"
      )
    ).toBe(true);
    expect(
      startupReadinessEvidenceCodeFingerprintStale(
        { codeState: { fingerprint: "same" } },
        "same"
      )
    ).toBe(false);
  });

  it("builds stable current-evidence keys for superseding", () => {
    expect(
      startupReadinessEvidenceCurrentKey(
        { type: "startup_ui_validation", uri: "file:///ui.json" },
        {
          content: JSON.stringify({ url: "http://127.0.0.1:3000", viewport: "desktop" })
        }
      )
    ).toBe("startup_ui_validation:http://127.0.0.1:3000:desktop");
    expect(
      startupReadinessEvidenceCurrentKey(
        { type: "startup_metric_snapshot", uri: "file:///metric.json" },
        { content: JSON.stringify({ metric: "activation" }) }
      )
    ).toBe("startup_metric_snapshot:activation");
  });

  it("parses startup artifact content and source records conservatively", () => {
    const artifact = {
      content: JSON.stringify({ metric: "retention" }),
      sources: [{ uri: "https://example.test" }, "bad"]
    };

    expect(parsedStartupReadinessArtifactContent(artifact)).toEqual({
      metric: "retention"
    });
    expect(startupReadinessArtifactSources(artifact)).toEqual([
      { uri: "https://example.test" }
    ]);
    expect(stagingDeploymentText("staging deployment passed")).toBe(true);
  });
});
