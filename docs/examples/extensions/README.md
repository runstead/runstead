# Extension Examples

These manifests are copyable examples for `.runstead/extensions`. They model
common launch-readiness integrations without requiring real credentials in the
fixture path.

Copy one or more manifests into a repo:

```bash
mkdir -p .runstead/extensions
cp docs/examples/extensions/posthog-activation.yaml .runstead/extensions/
runstead startup ready --cwd . --stage launch --target production --plan
```

Package-shaped extensions are supported too:

```bash
cp -R docs/examples/extensions/growth-readiness-package .runstead/extensions/
runstead startup ready --cwd . --stage launch --target local --plan
```

The fixture commands point at `fixtures/runstead-extension-fixture.mjs` and
produce deterministic JSON evidence. The package-shaped example ships its own
`collector.mjs`. Replace those commands with real integration adapters when
connecting PostHog, Vercel, Sentry, GitHub, or a private extension package.

Executable collectors print either a single evidence object or:

```json
{
  "evidence": [
    {
      "type": "metric_snapshot",
      "summary": "Activation metric",
      "content": {
        "metric": "activation",
        "source": "posthog",
        "threshold": 40,
        "current": 48
      }
    }
  ]
}
```

Runstead validates the evidence type against `producesEvidenceTypes`, records it
through startup evidence, and applies collector policy metadata such as
`safeForWrappedWorkers`, `qualityTier`, and `defaultFreshnessDays`.
