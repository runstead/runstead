import { describe, expect, it } from "vitest";

import {
  defineReadinessFacet,
  defineRunsteadExtension,
  extensionReadinessTargets,
  validateRunsteadExtension
} from "./index.js";

describe("Runstead SDK extension contracts", () => {
  it("defines readiness facets with stable defaults", () => {
    const facet = defineReadinessFacet({
      name: "activation-metric",
      title: "Activation metric",
      description: "Activation metric evidence needed for launch.",
      requiredEvidenceTiers: ["local_command"],
      requiredEvidenceTypes: ["startup_metric_snapshot"]
    });

    expect(facet).toMatchObject({
      name: "activation-metric",
      fields: [],
      appliesToTargets: ["local", "staging", "production"],
      blockers: []
    });
  });

  it("defines domain extensions for facets, collectors, verifiers, and gates", () => {
    const extension = defineRunsteadExtension({
      schemaVersion: 1,
      id: "growth-readiness",
      version: "0.1.0",
      name: "Growth readiness",
      description: "Growth-stage readiness facets for product-led launches.",
      domains: ["ai-native-startup"],
      facets: [
        {
          name: "activation-metric",
          title: "Activation metric",
          description: "Activation metric evidence needed for launch.",
          appliesToTargets: ["staging", "production"],
          requiredEvidenceTypes: ["startup_metric_snapshot"]
        }
      ],
      collectors: [
        {
          id: "posthog-activation",
          title: "PostHog activation",
          description: "Collect activation metrics from PostHog.",
          producesEvidenceTypes: ["startup_metric_snapshot"],
          requiredSecrets: ["POSTHOG_API_KEY"]
        }
      ],
      verifiers: [
        {
          id: "metric-contract",
          command: "npm run test:metrics",
          evidenceTier: "local_command",
          producesEvidenceTypes: ["command_output"]
        }
      ],
      gates: [
        {
          id: "production-growth",
          stage: "launch",
          target: "production",
          requiredFacets: ["activation-metric"],
          requiredEvidenceTiers: ["real_user_analytics"]
        }
      ]
    });

    expect(extension.collectors[0]).toMatchObject({
      id: "posthog-activation",
      safeForWrappedWorkers: false
    });
    expect(extensionReadinessTargets(extension)).toEqual(["staging", "production"]);
  });

  it("reports validation issues without throwing", () => {
    const result = validateRunsteadExtension({
      schemaVersion: 1,
      id: "bad",
      version: "0.1.0",
      name: "Bad",
      description: "Duplicate verifier ids.",
      domains: ["ai-native-startup"],
      verifiers: [
        {
          id: "smoke",
          command: "npm test"
        },
        {
          id: "smoke",
          command: "npm run lint"
        }
      ]
    });

    expect(result).toEqual({
      valid: false,
      issues: ["verifiers: Duplicate verifiers id: smoke"]
    });
  });
});
