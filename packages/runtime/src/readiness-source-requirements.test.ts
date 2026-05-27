import { describe, expect, it } from "vitest";

import {
  runtimeStartupSourceConnectorReadinessEvidenceRequirements,
  runtimeStartupSourceConnectorRequirementBlockers,
  runtimeStartupSourceConnectorRequirementsForTarget
} from "./readiness-source-requirements.js";

describe("readiness source connector requirements", () => {
  it("does not require external connectors for local readiness", () => {
    expect(
      runtimeStartupSourceConnectorRequirementsForTarget({ target: "local" })
    ).toEqual([]);
  });

  it("requires staging CI, deployment, and monitoring connectors", () => {
    const requirements = runtimeStartupSourceConnectorRequirementsForTarget({
      target: "staging",
      env: {
        GITHUB_TOKEN: "gh",
        VERCEL_TOKEN: "vercel"
      }
    });

    expect(requirements.map((requirement) => requirement.id)).toEqual([
      "remote-ci",
      "deployment-provider",
      "monitoring-provider"
    ]);
    expect(requirements[0]?.blockers).toEqual([]);
    expect(requirements[1]).toMatchObject({
      evidenceTiers: ["staging_deployment"],
      missingTokenEnv: []
    });
    expect(requirements[2]?.blockers).toEqual([
      "Monitoring provider connector requires SENTRY_AUTH_TOKEN for staging readiness"
    ]);
  });

  it("adds production analytics and maps requirements into readiness evidence", () => {
    const requirements = runtimeStartupSourceConnectorRequirementsForTarget({
      target: "production",
      env: {
        GITHUB_TOKEN: "gh",
        RENDER_API_KEY: "render",
        SENTRY_AUTH_TOKEN: "sentry",
        POSTHOG_API_KEY: "posthog"
      }
    });

    expect(runtimeStartupSourceConnectorRequirementBlockers(requirements)).toEqual([]);
    expect(
      runtimeStartupSourceConnectorReadinessEvidenceRequirements(requirements)
    ).toEqual([
      {
        source: "startup_source",
        sourceId: "remote-ci",
        targets: ["production"],
        evidenceTiers: ["ci_verified"],
        evidenceTypes: ["startup_repo_readiness"]
      },
      {
        source: "startup_source",
        sourceId: "deployment-provider",
        targets: ["production"],
        evidenceTiers: ["production_deployment"],
        evidenceTypes: ["startup_release_plan"]
      },
      {
        source: "startup_source",
        sourceId: "monitoring-provider",
        targets: ["production"],
        evidenceTiers: [],
        evidenceTypes: ["startup_monitoring_alerts"]
      },
      {
        source: "startup_source",
        sourceId: "analytics-provider",
        targets: ["production"],
        evidenceTiers: ["real_user_analytics"],
        evidenceTypes: ["startup_metric_snapshot"]
      }
    ]);
  });
});
