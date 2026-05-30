# Connectors

Connectors are Runstead's canonical names for external and workspace data
access. Packs and extensions should refer to these ids instead of inventing
provider-specific vocabulary.

The built-in catalog covers:

| Connector | Category | Status | Primary use |
| --- | --- | --- | --- |
| `github` | code hosting | executable | repository, workflow, pull request, and issue evidence |
| `vercel` | deployment | executable | deployment and preview readiness evidence |
| `sentry` | observability | executable | release health, errors, and issue context |
| `posthog` | analytics | executable | activation, retention, cohort, and funnel evidence |
| `email` | communication | catalog | mailbox reads and draft-only follow-up workflows |
| `web` | research | catalog | web pages, PDFs, search results, and citations |
| `docs` | knowledge | executable | workspace documentation and institutional memory |

`executable` means Runstead already has a startup source connector adapter or
source evidence path. `catalog` means the connector id, data shape, and policy
intent are declared, while a pack, extension, or future adapter supplies the
actual collection implementation.

## CLI

Inspect the catalog:

```bash
runstead connector list
runstead connector show github
runstead connector show email --json
```

The connector report declares:

- credential environment variables
- readable resources
- writable resources, when any
- evidence types produced by the connector
- domain packs that currently use the connector
- existing startup source connectors, when the connector is executable

## Relationship To Startup Sources

The AI-native startup path already had source connectors such as
`github_actions`, `vercel`, `sentry`, and `posthog`. The connector catalog is a
higher-level layer above those task-specific adapters:

- `github` groups `github_actions`, `github_pr`, and `github_issue`
- `vercel` maps to the `vercel` startup source connector
- `sentry` maps to the `sentry` startup source connector
- `posthog` maps to the `posthog` startup source connector
- `docs` maps to the `docs` startup source connector

This keeps provider access consistent across Work Packs while preserving the
specific evidence adapters that already exist.
