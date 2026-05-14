# Domain Packs

Domain packs define what a class of long-running work means. They are templates
and contracts, not runtime state.

The first built-in domain pack is `repo-maintenance`. It starts with:

- `keep-ci-green` goal template
- `repo_inspect`, `run_local_verifiers`, and `ci_repair` task types
- shell plus wrapped coding-agent worker routing
- command and diff-scope verifier defaults
- protected-path security defaults

Runtime task and goal state belongs in SQLite under `.runstead/state.db`.
Domain YAML remains configuration and template material only.

## Create A Pack

Start from the scaffold instead of copying an existing pack by hand:

```sh
runstead domain create customer-ops --output ./customer-ops
runstead domain validate ./customer-ops
```

The generated pack is intentionally conservative. It creates a single goal
template, one manual-review task type, and a default policy that allows local
evidence collection while requiring approval before external writes.

## Directory Layout

A domain pack directory must contain:

```text
domain.yaml
goal-templates/
  <goal-template-id>.yaml
task-types/
  <task-type-id>.yaml
policies/
  <policy-id>.yaml
```

File names for goal templates and task types must match the id referenced from
`domain.yaml`. For example, `task_types: [manual_review]` must point at
`task-types/manual_review.yaml`.

## domain.yaml

`domain.yaml` is the pack manifest. Keep it small and declarative:

```yaml
id: customer-ops
version: 0.1.0
name: Customer Ops
description: Govern recurring customer operations work.

scope:
  resource_types:
    - ticket
    - customer_account

goal_templates:
  - weekly-triage

task_types:
  - draft_followup

default_policy: policies/default.yaml

default_verifiers:
  - manual_review

required_tools:
  - filesystem

supported_workers:
  - shell

security:
  untrusted_inputs:
    - customer_message
  protected_paths:
    - ".env"
    - ".env.*"
```

Use lowercase kebab-case for pack ids. Use stable task and template ids because
goal state stores those ids in SQLite.

## Goal Templates

Goal templates describe durable intent and generated work:

```yaml
id: weekly-triage
domain: customer-ops
title: Weekly customer triage
description: >
  Review open customer requests, prepare follow-up drafts, and attach evidence.

generated:
  recurring_tasks:
    - draft_followup
  policy_profile: default
  acceptance_contracts:
    - draft_reviewed
    - recipient_checked
```

Recurring task ids must exist under `task-types/`. Acceptance contracts are
verifier-facing names; they should be specific enough that a reviewer can tell
what evidence is required.

## Task Types

Task types describe execution constraints, verifier requirements, and worker
routing:

```yaml
id: draft_followup
domain: customer-ops
description: Draft customer follow-up text without sending it.

default_priority: medium
max_attempts: 1

verifiers:
  required:
    - draft:recipient_checked
    - draft:send_not_performed

worker_routing:
  preferred: shell
```

Keep task types side-effect explicit. If a task can send mail, create PRs, push
branches, or call external APIs, policy must require approval unless the action
is deliberately safe for the domain.

## Validation

Run validation before installing or committing a pack:

```sh
runstead domain validate ./customer-ops
```

The validator checks that:

- `domain.yaml` is parseable.
- Manifest references resolve to files inside the pack.
- Goal templates and task types declare the same domain id as the pack.
- Referenced template and task ids match file names.
- Extra task type YAML files that are not registered in `domain.yaml` are warned.
- Task type worker routing must point at workers declared in `supported_workers`.
- The default policy file exists.
- The default policy declares `default_decision` and `default_risk`.

List discoverable packs with:

```sh
runstead domain list
runstead domain list --root ./domains
runstead domain list --cwd /path/to/runstead-workspace
```

## Install Locally

For a local Runstead workspace, copy or generate the pack under
`.runstead/domains/<domain-id>`:

```sh
runstead init
runstead domain create customer-ops --output .runstead/domains/customer-ops
runstead domain validate .runstead/domains/customer-ops
runstead goal create customer-ops --template weekly-triage
```

Do not put runtime state, generated reports, or task outputs inside the domain
pack. Those belong under `.runstead/state.db`, `.runstead/evidence`, and
`.runstead/reports`.
