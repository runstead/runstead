import { describe, expect, it } from "vitest";

import {
  readinessSourceEvidenceTiersForConnector,
  readinessSourceEvidenceTiersForStatus,
  readinessSourceStatusCountsForReadiness
} from "./readiness-source-evidence.js";

describe("readiness source evidence runtime", () => {
  it("maps source connectors to target-aware readiness tiers", () => {
    expect(
      readinessSourceEvidenceTiersForConnector({
        connector: "github_actions",
        sourceKind: "github_actions",
        target: "staging"
      })
    ).toEqual(["ci_verified"]);
    expect(
      readinessSourceEvidenceTiersForConnector({
        connector: "vercel",
        sourceKind: "vercel_deployment",
        target: "staging"
      })
    ).toEqual(["staging_deployment"]);
    expect(
      readinessSourceEvidenceTiersForConnector({
        connector: "render",
        sourceKind: "render_deployment",
        target: "production"
      })
    ).toEqual(["production_deployment"]);
    expect(
      readinessSourceEvidenceTiersForConnector({
        connector: "posthog",
        sourceKind: "posthog_analytics",
        target: "production"
      })
    ).toEqual(["real_user_analytics"]);
  });

  it("keeps local source evidence audit-visible but not tier-satisfying", () => {
    expect(
      readinessSourceEvidenceTiersForConnector({
        connector: "github_actions",
        sourceKind: "github_actions",
        target: "local"
      })
    ).toEqual([]);
  });

  it("only counts passed or manually recorded source evidence for readiness", () => {
    expect(readinessSourceStatusCountsForReadiness("passed")).toBe(true);
    expect(readinessSourceStatusCountsForReadiness(" recorded ")).toBe(true);
    expect(readinessSourceStatusCountsForReadiness("failed")).toBe(false);
    expect(
      readinessSourceEvidenceTiersForStatus({
        status: "failed",
        readinessTiers: ["ci_verified"]
      })
    ).toEqual([]);
  });
});
