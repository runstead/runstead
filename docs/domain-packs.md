# Domain Packs

Domain packs define what a class of long-running work means. They are
templates and contracts, not runtime state.

## Built-In Packs

The current built-ins are:

| Pack                | Workflows                                    | Task types                                                                                                      | Main boundary                                                                                       |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `repo-maintenance`  | `keep-ci-green`                              | `repo_inspect`, `run_local_verifiers`, `ci_repair`                                                              | repository inspection, verifier execution, CI repair, GitHub workflow and PR/comment evidence       |
| `ai-native-startup` | `validate-problem`, `build-mvp`, `scale-ops` | validation, agent context, measurement, repo readiness, MVP verifier, launch, support, GTM, and scale-ops tasks | startup/product readiness with approval-gated dependency, deployment, billing, and external writes  |
| `research-monitor`  | `weekly-research-digest`                     | source discovery, source scanning, reliability, summarization, conflict triage, release gate, archive memory    | cited research output with source freshness, citation, contradiction, publish, and archive evidence |
| `email-followup`    | `draft-pending-followups`                    | thread scan, follow-up classification, recipient verification, draft creation, safety review, memory archive    | draft-only email follow-up with send actions denied                                                 |

See [capability-matrix.md](capability-matrix.md) for the connector and adapter
matrix behind these packs.

`repo-maintenance` is the original control-loop pack:

- `keep-ci-green` goal template
- `repo_inspect`, `run_local_verifiers`, and `ci_repair` task types
- shell plus wrapped coding-agent worker routing
- command and diff-scope verifier defaults
- protected-path security defaults
- a `js-test-failure` CI repair smoke fixture and benchmark

`ai-native-startup` is the startup execution pack:

- `validate-problem` template records hypotheses, validation evidence,
  disconfirming evidence, and the MVP build gate before build work starts
- `build-mvp` template creates tasks for agent context generation,
  measurement framework definition, repository readiness inspection, and
  MVP verifier evidence
- `scale-ops` template adds founder bottleneck mapping, workflow
  automation registry, SOP generation, support triage, and GTM artifact
  verification
- the pack keeps code edits, publishing, external writes, and worker
  starts behind approval while allowing read-only inspection, evidence
  records, reports, gates, and local verifier commands

`research-monitor` is a maturity-gated built-in pack that proves the pack
model can support non-startup workflows. It models a discover → scan →
reliability assessment → digest → conflict triage → publish gate → archive
lifecycle for recurring cited research work, with source freshness, source
reliability, contradiction review, citation quality, archive memory, and
external publish approval contracts. Its fixtures cover source discovery,
source reliability, a weekly digest smoke path, conflicting source
regression, approval-gated publish review, and archive updates. See
[`research-monitor-golden-path.md`](research-monitor-golden-path.md).

`email-followup` is a draft-only productivity pack. It models scan →
follow-up classification → recipient verification → draft creation → safety
review → memory archive for inbox follow-ups. The policy allows mailbox
read, contact lookup, draft creation, and follow-up memory updates while
denying send actions and external send side effects. Its fixtures cover
thread triage, recipient safety, draft-only smoke, send-block regression,
and durable follow-up memory. See
[`email-followup-golden-path.md`](email-followup-golden-path.md).

The two non-startup packs are also summarized together in
[`non-startup-domain-golden-paths.md`](non-startup-domain-golden-paths.md),
which lists the copyable commands and executable regression gates that prove
the pack abstraction is not hard-coded to startup readiness.

Runtime task and goal state belongs in SQLite under `.runstead/state.db`.
Domain YAML remains configuration and template material only.

Use `@runstead/sdk` when a pack needs to publish typed extension contracts
for custom readiness facets, evidence collectors, verifiers, or gates.
Domain YAML owns installable pack templates; SDK manifests own stable
integration contracts for code and third-party packages.

## Create A Pack

Start from the scaffold instead of copying an existing pack by hand:

```sh
runstead domain create customer-ops --output ./customer-ops
runstead domain validate ./customer-ops
```

The generated pack is intentionally conservative. It creates a single goal
template, one manual-review task type, and a default policy that allows
local evidence collection while requiring approval before external writes. It
also writes `AUTHORING.md` and evaluator stubs so a new domain starts as a
task-policy-evidence contract rather than a prompt bundle.

`manual_review` has a built-in runtime route. `runstead run <pack> <workflow>`
queues generated domain tasks and executes known generic routes from the task
contract; manual-review tasks are marked `blocked` with
`manual_review_required` instead of being treated as unknown custom tasks. Use
`runstead run --once` when you explicitly want the legacy next-queued-task
executor.

## Capability Policy

Every built-in pack declares `capability_policy` in `domain.yaml`. This is the
pack-level summary of what the work is expected to touch before detailed policy
rules are evaluated:

```yaml
capability_policy:
  reads:
    - filesystem.repo
  writes:
    - runstead.evidence
  approvals_required:
    - external_write
  denied:
    - secret_read
```

Use this section to make pack boundaries obvious to operators and extension
authors:

- `reads` declares resources the pack can inspect
- `writes` declares resources the pack can create or modify
- `approvals_required` declares side effects that must route through approval
- `denied` declares resources or actions the pack must not perform

The detailed `policies/*.yaml` file remains the executable decision policy.
`capability_policy` is the pack-level contract surfaced by catalog, show, and
run commands so users can see the boundary before work starts.

## Evidence Contracts

Every built-in pack also declares `evidence_contracts` for its high-level
workflows. Each contract names what evidence the workflow must output and what
completion criteria have to be satisfied before the workflow can be treated as
done:

```yaml
evidence_contracts:
  - workflow: default-goal
    outputs:
      - manual_review
      - runstead.evidence
    completion_criteria:
      - manual_review_complete
      - evidence_attached
```

The validator rejects evidence contracts that reference unknown workflows. A
workflow can be a `goal_templates` id or a `task_types` id, but built-in packs
use the goal-template ids as the user-facing scenarios. `runstead run --plan`
surfaces these contracts before execution; `runstead run <pack> <workflow>`
evaluates them after execution and keeps the workflow verdict incomplete when
declared business evidence is missing, even if the underlying task execution
finished.

Every evidence output and completion criterion should have a matching
`evidence_requirement_evaluators` entry. Evaluators describe which evidence
types, task statuses, or event types prove a business requirement:

```yaml
evidence_requirement_evaluators:
  - requirement: evidence_attached
    evidence_types:
      - manual_review
      - runstead.evidence
  - requirement: manual_review_complete
    task_types:
      - manual_review
    task_statuses:
      - blocked
      - completed
```

The maturity gate checks evaluator coverage so a domain pack cannot look mature
while leaving business completion semantics implicit.

This is the key difference between a Runstead domain pack and a prompt bundle:
the pack has to declare what the business workflow means, what it may touch,
what evidence proves completion, and how that evidence is evaluated.

Installing, uninstalling, or upgrading a pack mutates the local
`.runstead/domains` registry and requires the actor to have `domain.manage`.
Read-only SDK commands such as `domain validate`, `domain manifest`, and
`domain verify-manifest` operate on explicit directories and do not require
registry access. `runstead doctor` verifies every installed pack against
its stored manifest so local registry drift is surfaced before scheduled
work uses the pack.

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
fixtures/
  manifest.yaml
  <fixture-id>/
evals/
  benchmark.yaml
```

File names for goal templates and task types must match the id referenced
from `domain.yaml`. For example, `task_types: [manual_review]` must point
at `task-types/manual_review.yaml`.

## domain.yaml

`domain.yaml` is the pack manifest. Keep it small and declarative:

```yaml
id: customer-ops
version: 0.1.0
name: Customer Ops
description: Govern recurring customer operations work.

compatibility:
  runstead_min_version: 0.0.0

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

Use lowercase kebab-case for pack ids. Use stable task and template ids
because goal state stores those ids in SQLite.

`compatibility.runstead_min_version` is required. Bump it when a pack
starts depending on newer Runstead policy, verifier, worker, or manifest
behavior.

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
verifier-facing names; they should be specific enough that a reviewer can
tell what evidence is required.

## Task Types

Task types describe execution constraints, verifier requirements, and
worker routing:

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

Keep task types side-effect explicit. If a task can send mail, create PRs,
push branches, or call external APIs, policy must require approval unless
the action is deliberately safe for the domain.

## Fixtures And Evals

Fixtures are optional, but published packs should include them once task
contracts stabilize:

```yaml
version: 1
fixtures:
  - id: draft-followup-smoke
    description: Representative follow-up draft input and expected evidence.
    path: draft-followup-smoke
    task_type: draft_followup
    goal_template: weekly-triage
    tags:
      - smoke
    acceptance_contracts:
      - draft_reviewed
      - recipient_checked
```

Evals reference fixture ids and acceptance contracts:

```yaml
version: 1
benchmarks:
  - id: draft-followup-smoke
    fixture: draft-followup-smoke
    acceptance_contracts:
      - draft_reviewed
      - recipient_checked
```

## Validation

Run validation before installing or committing a pack:

```sh
runstead domain validate ./customer-ops
```

The validator checks that:

- `domain.yaml` is parseable.
- `domain.yaml` declares Runstead compatibility metadata.
- Manifest references resolve to files inside the pack.
- Manifest, policy, template, task type, fixture, and eval paths are not
  symlinks and do not escape the pack directory.
- Goal templates and task types declare the same domain id as the pack.
- Referenced template and task ids match file names.
- Extra task type YAML files that are not registered in `domain.yaml` are
  warned.
- Task type worker routing must point at workers declared in
  `supported_workers`.
- The default policy file exists.
- The default policy declares `default_decision` and `default_risk`.
- Fixture manifests reference known task types, templates, and local
  fixture paths.
- Eval benchmarks reference known fixture ids.

For packaged or installed packs, verify the stored manifest before trusting
it:

```sh
runstead domain manifest ./customer-ops --output ./customer-ops/runstead-manifest.json
runstead domain verify-manifest ./customer-ops
runstead domain maturity ./customer-ops
```

Manifest verification rebuilds the current manifest and compares domain
metadata, file sizes, and sha256 hashes against `runstead-manifest.json`.
The `maturity` command reports a pack's maturity tier based on declared
fixtures, evals, and contract coverage.

## Package And Share

Build a deterministic JSON bundle when a pack needs to move between
workspaces:

```sh
runstead domain pack ./customer-ops --output customer-ops.runstead-pack.json
```

The bundle embeds the manifest plus base64 file contents. Unpack it into a
new directory with:

```sh
runstead domain unpack customer-ops.runstead-pack.json --output ./customer-ops
```

Unpacking verifies every file against the embedded manifest hashes, rejects
unsafe paths, and writes `runstead-manifest.json` next to the extracted
pack files. Use `--force` only when replacing an existing extracted pack.

List discoverable packs with:

```sh
runstead domain list
runstead domain list --root ./domains
runstead domain list --cwd /path/to/runstead-workspace
runstead domain show repo-maintenance
```

## Install Locally

For a local Runstead workspace, copy or generate the pack under
`.runstead/domains/<domain-id>`:

```sh
runstead init
runstead domain create customer-ops --output ./customer-ops
runstead domain install ./customer-ops
runstead domain validate .runstead/domains/customer-ops
runstead goal create customer-ops --template weekly-triage
```

Upgrade an installed pack from a validated id or path:

```sh
runstead domain upgrade ./customer-ops
```

Runstead records `domain_pack.upgraded` with the previous and next manifest
versions. Upgrades are refused while active goals or tasks reference the
pack unless `--force` is used.

Install and upgrade both enforce `compatibility.runstead_min_version` and
`compatibility.runstead_max_version` against the current Runstead CLI
version.

Remove a locally installed pack when it is no longer referenced by active
work:

```sh
runstead domain uninstall customer-ops
```

Runstead refuses to uninstall a pack while active goals or tasks still
reference it. Use `--force` only after you have archived or otherwise
accounted for that work; forced uninstalls are still recorded in the audit
log.

When a goal template declares `generated.recurring_tasks`, Runstead creates
initial queued tasks from the referenced task type contracts. The
background scheduler uses the same task type contracts for later
recurrences; the `repo-maintenance` `run_local_verifiers` task keeps its
special test/lint command detection path.

Do not put runtime state, generated reports, or task outputs inside the
domain pack. Those belong under `.runstead/state.db`, `.runstead/evidence`,
and `.runstead/reports`.

## Extension Manifests Versus Domain Packs

Domain packs ship installable task and goal contracts. Extension manifests
in `.runstead/extensions/` ship readiness facets, evidence collectors,
verifiers, and gates declared through `@runstead/sdk`. The two layers can
coexist: a published pack may also ship example extension manifests under
its own docs or fixture tree, and an organization can drop additional
extension manifests next to any installed pack.
