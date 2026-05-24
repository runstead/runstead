import { describe, expect, it } from "vitest";

import {
  compileRunsteadExtensionRuntime,
  defineReadinessFacet,
  defineRunsteadExtension,
  extensionCollectorPolicyBlockers,
  extensionReadinessEvidenceRequirements,
  extensionReadinessRequirementBlockers,
  extensionReadinessTargets,
  RunsteadExtensionCompileError,
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
          command: "npm test -- --collector posthog-activation",
          targets: ["staging", "production"],
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
      command: "npm test -- --collector posthog-activation",
      targets: ["staging", "production"],
      safeForWrappedWorkers: false,
      qualityTier: "none"
    });
    expect(extensionReadinessTargets(extension)).toEqual(["staging", "production"]);
  });

  it("compiles extension manifests into runtime-loadable contracts", () => {
    const runtime = compileRunsteadExtensionRuntime({
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
          requiredEvidenceTiers: ["real_user_analytics"],
          requiredEvidenceTypes: ["startup_metric_snapshot"],
          blockers: ["activation metric evidence is missing"]
        }
      ],
      collectors: [
        {
          id: "posthog-activation",
          title: "PostHog activation",
          description: "Collect activation metrics from PostHog.",
          command: "npm test -- --collector posthog-activation",
          adapterId: "posthog",
          targets: ["production"],
          outputSchema: {
            type: "startup_metric_snapshot"
          },
          producesEvidenceTypes: ["startup_metric_snapshot"],
          requiredSecrets: ["POSTHOG_API_KEY"],
          safeForWrappedWorkers: true,
          qualityTier: "external_observed",
          defaultFreshnessDays: 14
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

    expect(runtime).toMatchObject({
      schemaVersion: 1,
      extensionId: "growth-readiness",
      readinessTargets: ["staging", "production"],
      requiredSecrets: ["POSTHOG_API_KEY"],
      requiredEvidenceTiers: ["real_user_analytics", "local_command"],
      requiredEvidenceTypes: ["startup_metric_snapshot", "command_output"],
      safeForWrappedWorkers: true
    });
    expect(runtime.collectors[0]).toMatchObject({
      command: "npm test -- --collector posthog-activation",
      adapterId: "posthog",
      targets: ["production"],
      outputSchema: {
        type: "startup_metric_snapshot"
      },
      qualityTier: "external_observed",
      defaultFreshnessDays: 14
    });
    expect(runtime.gates[0]?.requiredFacets[0]?.name).toBe("activation-metric");
    expect(runtime.evidenceRequirements).toContainEqual(
      expect.objectContaining({
        source: "facet",
        sourceId: "activation-metric",
        blockers: ["activation metric evidence is missing"]
      })
    );
    expect(runtime.evidenceRequirements).toContainEqual(
      expect.objectContaining({
        source: "verifier",
        sourceId: "metric-contract",
        evidenceTypes: ["command_output"]
      })
    );
  });

  it("rejects runtime contracts that reference unknown facets", () => {
    expect(() =>
      compileRunsteadExtensionRuntime({
        schemaVersion: 1,
        id: "bad-runtime",
        version: "0.1.0",
        name: "Bad runtime",
        description: "Bad gate reference.",
        domains: ["ai-native-startup"],
        gates: [
          {
            id: "launch",
            stage: "launch",
            target: "production",
            requiredFacets: ["missing-facet"]
          }
        ]
      })
    ).toThrow(RunsteadExtensionCompileError);
  });

  it("converts extension runtime contracts into readiness requirements outside CLI", () => {
    const runtime = compileRunsteadExtensionRuntime({
      schemaVersion: 1,
      id: "growth-readiness",
      version: "0.1.0",
      name: "Growth readiness",
      description: "Growth checks for startup launches.",
      domains: ["ai-native-startup"],
      facets: [
        {
          name: "activation-metric",
          title: "Activation metric",
          description: "Activation metric evidence.",
          appliesToTargets: ["production"],
          requiredEvidenceTypes: ["startup_metric_snapshot"],
          blockers: ["activation metric evidence is missing"]
        }
      ],
      collectors: [
        {
          id: "posthog-activation",
          title: "PostHog activation",
          description: "Collect activation.",
          targets: ["production"],
          producesEvidenceTypes: ["startup_metric_snapshot"],
          qualityTier: "self_reported",
          safeForWrappedWorkers: false
        }
      ],
      gates: [
        {
          id: "launch-growth",
          stage: "launch",
          target: "production",
          requiredFacets: ["activation-metric"]
        }
      ]
    });

    const requirements = extensionReadinessEvidenceRequirements([runtime], {
      stage: "launch"
    });

    expect(requirements).toContainEqual(
      expect.objectContaining({
        source: "extension",
        sourceId: "growth-readiness/activation-metric",
        targets: ["production"],
        evidenceTypes: ["startup_metric_snapshot"],
        blockers: [
          "extension growth-readiness/activation-metric: activation metric evidence is missing"
        ]
      })
    );
    expect(
      extensionReadinessRequirementBlockers({
        requirements,
        target: "production",
        evidenceTiers: [],
        evidenceTypes: []
      })
    ).toEqual([
      "extension growth-readiness/activation-metric: activation metric evidence is missing"
    ]);
    expect(
      extensionCollectorPolicyBlockers({
        contracts: [runtime],
        requirements,
        target: "production",
        worker: "codex_cli",
        governanceProfile: "readiness"
      })
    ).toEqual([
      "extension growth-readiness/posthog-activation is not safe for Level 1 wrapped workers; use --worker codex_direct --governance governed",
      "extension growth-readiness/posthog-activation quality self_reported is below external_observed for production readiness",
      "extension growth-readiness/posthog-activation must declare defaultFreshnessDays for production readiness"
    ]);
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
