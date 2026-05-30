# Capability Matrix

This document is the current implementation map for Runstead. It separates
what is already executable from what is a declared contract, so users can see
where Runstead is a working control plane today and where new adapters or
domain packs are still needed.

## Positioning

Runstead is a governed AI work control plane. The first product wedge remains
AI-coded MVP and startup launch readiness, but the current architecture is not
hard-coded to coding MVP work.

The reusable unit is a Work Pack:

```text
Work Pack = domain pack + optional workspace extensions + optional skills
```

A domain pack defines business workflow shape, task types, policy, evidence
contracts, requirement evaluators, fixtures, and evals. Connectors and
extensions add external source collection, provider evidence, workspace gates,
and runtime verifiers. The run surface reports both execution status and
business evidence status.

## Capability Layers

| Layer                        | Current role                                                                      | Main surfaces                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Work Pack                    | Operator-facing unit for reusable AI work                                         | `runstead run <pack> <workflow>`, `runstead domain show <pack>`         |
| Runtime entrypoints          | CLI, CI, operator API, schedule, and gateway entry contracts per Work Pack        | `workPack.entrypoints`, `workPack.runtimeEnvironments`                  |
| Interaction surface          | Approval, evidence, scheduled-check, and webhook-intake routes for a Work Pack    | `runstead run <pack> <workflow> --plan`                                 |
| Domain pack                  | Business contract for goals, tasks, policy, evidence, evaluators, fixtures, evals | `packages/domain-packs/packs/*`, `runstead domain *`                    |
| Connector catalog            | Canonical provider/workspace connector names and maturity                         | `runstead connector list`, `runstead connector show <id>`               |
| Startup source connectors    | Target-aware external evidence contracts for launch readiness                     | `runstead startup source record/collect/verify`, `startup ready --plan` |
| Provider adapters            | HTTP collection, auth header shaping, response parsing, secret redaction          | `@runstead/runtime` source-provider helpers plus CLI collection         |
| Extensions                   | Workspace or package-provided facets, collectors, verifiers, gates                | `.runstead/extensions/*`, `@runstead/sdk`                               |
| Skill readiness              | Activated worker guidance dependency, fallback, platform, and worker fit          | `skill.yaml readiness`, `runstead run --plan`                           |
| Evidence contract evaluators | Domain-specific completion semantics                                              | `evidence_requirement_evaluators` in `domain.yaml`                      |

## Built-In Domain Packs

| Domain pack         | Purpose                                                                               | Workflows                                    | Task types                                                                                                                                                                                                                                                                                                                | Current connector dependence                                                             |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `repo-maintenance`  | Govern repo inspection, local verifier runs, and CI repair loops                      | `keep-ci-green`                              | `repo_inspect`, `run_local_verifiers`, `ci_repair`                                                                                                                                                                                                                                                                        | `github` for workflow-run and PR/comment surfaces                                        |
| `ai-native-startup` | Govern AI-coded MVP, validation, launch readiness, and scale operations               | `validate-problem`, `build-mvp`, `scale-ops` | `collect_customer_evidence`, `check_disconfirming_evidence`, `run_build_gate`, `generate_agent_context`, `define_measurement_framework`, `inspect_repo_readiness`, `run_mvp_verifiers`, `map_founder_bottlenecks`, `register_workflow_automation`, `generate_ops_sops`, `triage_support_evidence`, `verify_gtm_artifacts` | `github`, `vercel`, `sentry`, `posthog`, `docs`; workspace extensions can add more gates |
| `research-monitor`  | Produce recurring cited research digests with source reliability and archive evidence | `weekly-research-digest`                     | `discover_sources`, `scan_sources`, `evaluate_source_reliability`, `summarize_findings`, `triage_source_conflicts`, `prepare_digest_release`, `archive_research_memory`                                                                                                                                                   | `web` is catalog-only; `docs` is executable                                              |
| `email-followup`    | Draft-only inbox follow-up workflow with recipient and send-boundary evidence         | `draft-pending-followups`                    | `scan_threads`, `classify_followup_need`, `verify_recipients`, `draft_followup`, `review_draft_safety`, `archive_followup_memory`                                                                                                                                                                                         | `email` is catalog-only                                                                  |

All built-in packs declare capability policy and evidence contracts. Mature
packs also carry fixtures and evals. Evidence requirement evaluators now define
which evidence types, task statuses, or events satisfy each business output or
completion criterion.

## Canonical Connector Catalog

These are the connector ids packs and extensions should use when referring to
external or workspace data.

| Connector | Category      | Status     | Credentials         | Supported domains                       | Evidence types                                                                           | Startup source mapping                        |
| --------- | ------------- | ---------- | ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| `github`  | code hosting  | executable | `GITHUB_TOKEN`      | `repo-maintenance`, `ai-native-startup` | `repo_readiness`, `repo_inspection`, `github_workflow_run`, `decision`, `support_triage` | `github_actions`, `github_pr`, `github_issue` |
| `vercel`  | deployment    | executable | `VERCEL_TOKEN`      | `ai-native-startup`                     | `deployment`, `startup_repo_readiness`                                                   | `vercel`                                      |
| `sentry`  | observability | executable | `SENTRY_AUTH_TOKEN` | `ai-native-startup`                     | `startup_security_baseline`, `startup_repo_readiness`                                    | `sentry`                                      |
| `posthog` | analytics     | executable | `POSTHOG_API_KEY`   | `ai-native-startup`                     | `startup_measurement_framework`, `startup_metric_snapshot`                               | `posthog`                                     |
| `docs`    | knowledge     | executable | `DOCS_API_TOKEN`    | `ai-native-startup`, `research-monitor` | `institutional_memory`, `source_inventory`, `archive_record`                             | `docs`                                        |
| `email`   | communication | catalog    | `EMAIL_READ_TOKEN`  | `email-followup`                        | `thread_inventory`, `recipient_review`, `draft_preview`                                  | none                                          |
| `web`     | research      | catalog    | none                | `research-monitor`                      | `source_inventory`, `retrieval_log`, `citation_ledger`                                   | none                                          |

`executable` means Runstead already has a source evidence path, startup source
adapter, or provider collection path. `catalog` means the connector id, data
shape, policy intent, and evidence requirements are declared, but a future
adapter or extension still has to provide collection.

## Startup Source Connectors

Startup source connectors are target-aware external evidence contracts used by
`startup ready`, `startup source record`, `startup source collect`, and
`startup source verify`.

| Connector              | Evidence type          | Use                                                       | Provider adapter               |
| ---------------------- | ---------------------- | --------------------------------------------------------- | ------------------------------ |
| `github_actions`       | `repo_readiness`       | CI and remote verifier evidence                           | `github` / `GITHUB_TOKEN`      |
| `gitlab_ci`            | `repo_readiness`       | GitLab CI and remote verifier evidence                    | `gitlab` / `GITLAB_TOKEN`      |
| `ci`                   | `repo_readiness`       | Generic remote CI evidence                                | contract only                  |
| `github_pr`            | `decision`             | Review, approval, and launch decision evidence            | contract only                  |
| `gitlab_merge_request` | `decision`             | GitLab review, approval, and launch decision evidence     | `gitlab` / `GITLAB_TOKEN`      |
| `github_issue`         | `support_triage`       | Support, feedback, or incident triage evidence            | contract only                  |
| `linear`               | `team_collaboration`   | Planning, triage, and workflow evidence                   | `linear` / `LINEAR_API_KEY`    |
| `jira`                 | `team_collaboration`   | Planning, triage, and workflow evidence                   | `jira` / `JIRA_API_TOKEN`      |
| `slack`                | `team_collaboration`   | Team discussion, decision, and handoff evidence           | `slack` / `SLACK_BOT_TOKEN`    |
| `docs`                 | `institutional_memory` | Workspace documentation and institutional memory evidence | `docs` / `DOCS_API_TOKEN`      |
| `vercel`               | `release_plan`         | Vercel staging or production deployment evidence          | `vercel` / `VERCEL_TOKEN`      |
| `fly`                  | `release_plan`         | Fly.io staging or production deployment evidence          | contract only                  |
| `render`               | `release_plan`         | Render staging or production deployment evidence          | `render` / `RENDER_API_KEY`    |
| `deployment`           | `release_plan`         | Generic staging or production deployment evidence         | contract only                  |
| `sentry`               | `monitoring_alerts`    | Production monitoring and alert evidence                  | `sentry` / `SENTRY_AUTH_TOKEN` |
| `observability`        | `observability`        | Monitoring, alert, and post-launch watch evidence         | contract only                  |
| `posthog`              | `metric_snapshot`      | Real-user product analytics evidence                      | `posthog` / `POSTHOG_API_KEY`  |
| `analytics`            | `metric_snapshot`      | Activation, retention, and real-user metric evidence      | contract only                  |
| `billing`              | `metric_snapshot`      | Revenue and conversion metric evidence                    | contract only                  |
| `support`              | `support_triage`       | Support ticket and feedback triage evidence               | contract only                  |
| `dependency`           | `security_baseline`    | Dependency and vulnerability scan evidence                | contract only                  |

Provider adapters define auth header behavior and HTTP collection. Structured
payload classification is deepest for `github_actions`, `gitlab_ci`, `vercel`,
`render`, `sentry`, and `posthog`. Other adapter-backed connectors can still
fetch and record provider JSON, but may use the generic parser until a
provider-specific classifier is added.

## Extension Examples

Copyable extension manifests live under `docs/examples/extensions`. They are
examples of the third-party/workspace extension contract, not global built-ins.

| Extension                      | Domain              | Collector surface                                           | Produces evidence                           | Notes                                       |
| ------------------------------ | ------------------- | ----------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `posthog-activation-readiness` | `ai-native-startup` | command plus `adapterId: posthog`                           | `startup_metric_snapshot`                   | staging/production activation metric gate   |
| `sentry-error-rate-readiness`  | `ai-native-startup` | command plus `adapterId: sentry`                            | `startup_observability`                     | production error-rate gate                  |
| `vercel-deployment-readiness`  | `ai-native-startup` | command plus `adapterId: vercel`                            | `startup_release_plan`                      | staging/production deployment gate          |
| `github-actions-ci-readiness`  | `ai-native-startup` | command plus `adapterId: github-actions`; includes verifier | `startup_decision`, `command_output`        | staging/production CI gate                  |
| `growth-package-readiness`     | `ai-native-startup` | package-shaped command collector and verifier               | `startup_metric_snapshot`, `command_output` | proves directory/package manifest discovery |

Work Pack plans now report extension readiness for the selected domain:

- `ready`: executable collector command or verifier is present and required
  secrets are available
- `missing_secrets`: executable contract exists but required env vars are
  absent
- `contract_only`: manifest exists but only declares a non-executable contract
- `missing`: a Work Pack component declares an extension that is not loaded from
  the workspace

## What Is Broad Versus Complete

Runstead now has the architecture of a broader AI work platform: Work Packs,
domain-specific evidence semantics, connector maturity, extension readiness,
governed worker modes, and evidence-first completion. That does not mean every
provider or business domain is already implemented.

Current gaps are explicit:

- `email` and `web` are catalog connectors; production-grade executable
  adapters still need to be added.
- Many startup source connectors are contract-only and depend on manual record,
  URI verification, or future provider adapters.
- New business domains still need intentional task type, policy, evidence
  contract, evaluator, fixture, and eval design.
- Team mode has a real Postgres backend adapter and conformance path, but a
  production organization deployment still needs IdP/RBAC, runner identity,
  central secret handling, and shared artifact storage.
