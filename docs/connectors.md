# Connectors

Connectors are Runstead's canonical names for external and workspace data
access. Packs and extensions should refer to these ids instead of inventing
provider-specific vocabulary. For the cross-product view, see
[capability-matrix.md](capability-matrix.md).

## Canonical Catalog

The built-in catalog covers:

| Connector | Category      | Status     | Credentials         | Supported domains                       | Primary evidence                                                       |
| --------- | ------------- | ---------- | ------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `github`  | code hosting  | executable | `GITHUB_TOKEN`      | `repo-maintenance`, `ai-native-startup` | repository, workflow, PR, issue, decision, and support-triage evidence |
| `vercel`  | deployment    | executable | `VERCEL_TOKEN`      | `ai-native-startup`                     | deployment and preview readiness evidence                              |
| `sentry`  | observability | executable | `SENTRY_AUTH_TOKEN` | `ai-native-startup`                     | release health, security baseline, errors, and issue context           |
| `posthog` | analytics     | executable | `POSTHOG_API_KEY`   | `ai-native-startup`                     | measurement framework and metric snapshot evidence                     |
| `docs`    | knowledge     | executable | `DOCS_API_TOKEN`    | `ai-native-startup`, `research-monitor` | workspace documentation and institutional memory                       |
| `email`   | communication | catalog    | `EMAIL_READ_TOKEN`  | `email-followup`                        | thread inventory, recipient review, and draft preview                  |
| `web`     | research      | catalog    | none                | `research-monitor`                      | web pages, PDFs, search results, citations, and retrieval logs         |

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
- lifecycle surfaces: `tool`, `evidence_source`, `profile_signal`, and
  `trigger_source`
- domain packs that currently use the connector
- existing startup source connectors, when the connector is executable

## Lifecycle Surfaces

OpenHuman-style connector modeling treats a connector as more than an adapter
handle. Each connector declares the roles it can play across a long-running
workflow:

- `tool`: a worker or operator can use the connector as a bounded action surface
  for reads, writes, or drafts
- `evidence_source`: the connector can produce evidence records used by
  domain contracts and readiness evaluators
- `profile_signal`: the connector can describe a repo, product, customer,
  source, or workspace profile that affects planning
- `trigger_source`: the connector can produce events that start, resume, or
  schedule governed work

These surfaces are independent of maturity. For example, `email` and `web`
already declare draft/research lifecycle surfaces even though they are still
catalog-only; `github` declares all four surfaces and already has executable
startup source mappings.

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

## Startup Source Connectors

Startup source connectors are lower-level source contracts used by
`runstead startup source record`, `runstead startup source collect`,
`runstead startup source verify`, and `startup ready --plan`.

| Connector              | Evidence type          | Provider adapter               |
| ---------------------- | ---------------------- | ------------------------------ |
| `github_actions`       | `repo_readiness`       | `github` / `GITHUB_TOKEN`      |
| `gitlab_ci`            | `repo_readiness`       | `gitlab` / `GITLAB_TOKEN`      |
| `ci`                   | `repo_readiness`       | contract only                  |
| `github_pr`            | `decision`             | contract only                  |
| `gitlab_merge_request` | `decision`             | `gitlab` / `GITLAB_TOKEN`      |
| `github_issue`         | `support_triage`       | contract only                  |
| `linear`               | `team_collaboration`   | `linear` / `LINEAR_API_KEY`    |
| `jira`                 | `team_collaboration`   | `jira` / `JIRA_API_TOKEN`      |
| `slack`                | `team_collaboration`   | `slack` / `SLACK_BOT_TOKEN`    |
| `docs`                 | `institutional_memory` | `docs` / `DOCS_API_TOKEN`      |
| `vercel`               | `release_plan`         | `vercel` / `VERCEL_TOKEN`      |
| `fly`                  | `release_plan`         | contract only                  |
| `render`               | `release_plan`         | `render` / `RENDER_API_KEY`    |
| `deployment`           | `release_plan`         | contract only                  |
| `sentry`               | `monitoring_alerts`    | `sentry` / `SENTRY_AUTH_TOKEN` |
| `observability`        | `observability`        | contract only                  |
| `posthog`              | `metric_snapshot`      | `posthog` / `POSTHOG_API_KEY`  |
| `analytics`            | `metric_snapshot`      | contract only                  |
| `billing`              | `metric_snapshot`      | contract only                  |
| `support`              | `support_triage`       | contract only                  |
| `dependency`           | `security_baseline`    | contract only                  |

Provider-backed source connectors share defensive collection behavior:
Runstead sends provider-specific auth headers, bounds fetch time, parses JSON,
redacts token-like fields before writing evidence, records malformed or
provider-error payloads explicitly, and only grants target readiness tiers when
the collected status is `passed`.

Structured result parsing is currently deepest for `github_actions`,
`gitlab_ci`, `vercel`, `render`, `sentry`, and `posthog`. Other provider-backed
connectors can fetch and record provider JSON, but may use generic parsing
until a provider-specific classifier is added.

## Work Pack Readiness Reporting

Work Pack plans evaluate connector readiness for the selected domain and
evidence contract:

- `ready`: executable connector credentials are available
- `missing_credentials`: executable connector exists but required env vars are
  absent
- `catalog_only`: the connector contract exists, but no executable adapter is
  registered

This is operator-facing by design: a Work Pack can be a mature business model
while still making external adapter gaps visible before execution.
