# SDK

`@runstead/sdk` defines the public contract for external Runstead extensions.
It is intentionally smaller than the CLI internals: extension authors describe
facets, evidence collectors, verifiers, and gates, while Runstead remains
responsible for state, policy, workers, and audit.

The SDK is the stable surface to use when a domain pack or integration needs to
declare readiness semantics without importing `@runstead/cli`.

## Extension Manifest

```ts
import { defineRunsteadExtension } from "@runstead/sdk";

export default defineRunsteadExtension({
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
      command:
        "node .runstead/extensions/fixtures/runstead-extension-fixture.mjs posthog-activation",
      adapterId: "posthog",
      targets: ["staging", "production"],
      producesEvidenceTypes: ["startup_metric_snapshot"],
      requiredSecrets: ["POSTHOG_API_KEY"],
      safeForWrappedWorkers: true,
      qualityTier: "external_observed",
      defaultFreshnessDays: 7
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
```

## Contract Shape

An extension manifest contains:

- `facets`: named readiness dimensions, such as activation metrics, rollback,
  migration, support triage, or security review.
- `collectors`: integrations that produce evidence records. Collector metadata
  includes `command`, `adapterId`, `targets`, `safeForWrappedWorkers`,
  `qualityTier`, `defaultFreshnessDays`, and `requiredSecrets`; startup
  readiness treats these as policy inputs when a collector can satisfy an
  extension evidence requirement. Today, CLI execution requires `command`;
  `adapterId` is stable integration metadata for provider-specific adapters.
- `verifiers`: commands that produce local or CI evidence.
- `gates`: stage and target requirements that compose facets and evidence.

The SDK validates duplicate ids, target names, evidence tiers, semantic version
strings, and stable kebab-case ids.

## Validation

Use `validateRunsteadExtension` when loading untrusted or third-party
extension manifests:

```ts
import { validateRunsteadExtension } from "@runstead/sdk";

const result = validateRunsteadExtension(candidate);

if (!result.valid) {
  console.error(result.issues);
}
```

`defineRunsteadExtension` throws on invalid manifests and is intended for typed
authoring. `validateRunsteadExtension` returns structured issues and is intended
for loaders, registries, and tests.

## Runtime Compile

Use `compileRunsteadExtensionRuntime` when a loader needs the manifest converted
into a runtime contract:

```ts
import { compileRunsteadExtensionRuntime } from "@runstead/sdk";

const runtime = compileRunsteadExtensionRuntime(candidate);

console.log(runtime.requiredEvidenceTypes);
console.log(runtime.verifiers.map((verifier) => verifier.command));
```

The compiled contract resolves gate facet references, flattens required secrets
and evidence requirements, and rejects invalid references such as a gate that
requires an unknown facet.

## Startup Readiness Loader

`runstead startup ready` discovers extension manifests under
`.runstead/extensions`. A manifest may be a direct `.json`, `.yaml`, or `.yml`
file, or a directory containing `runstead-extension.{json,yaml,yml}` or
`extension.{json,yaml,yml}`.

Loaded manifests are compiled with `compileRunsteadExtensionRuntime`. Contracts
whose `domains` include `ai-native-startup` contribute their compiled evidence
requirements to the readiness engine, so extension facets and gates can block a
local, staging, or production verdict when their required evidence types or tiers
are missing.

Collector policy is enforced before the verdict is allowed:

- Level 1 wrapped workers reject collectors that are not
  `safeForWrappedWorkers`.
- Collector `qualityTier` must meet the requested target's minimum quality bar.
- Staging and production collectors must declare `defaultFreshnessDays`.
- Evidence with expired source freshness is excluded from readiness inputs
  instead of satisfying a gate.

When a collector declares a `command`, `runstead startup ready` runs it through
governed local tool execution, parses JSON evidence from stdout, validates the
evidence type against `producesEvidenceTypes`, and records startup evidence. A
collector with only `adapterId` is visible to planning and policy, but is skipped
until a runtime adapter or command is supplied. Extension verifiers are appended
to the existing verifier command list and run through the same verifier
infrastructure as test/lint/typecheck/build.

Copyable examples live under [docs/examples/extensions](examples/extensions).
They cover PostHog activation, Vercel deployment status, Sentry error rate, and
GitHub Actions CI with local fixture commands that require no real network
credentials.

## Boundaries

The SDK itself does not execute collectors, verifiers, or workers. It describes
and compiles contracts. Runstead CLI/runtime adapters execute collector commands,
verifier commands, and workers through governed runtime paths.

Keep extension code side-effect free at declaration time. Network calls,
credential reads, file writes, and worker execution belong in governed Runstead
runtime paths, not in manifest definition modules.
