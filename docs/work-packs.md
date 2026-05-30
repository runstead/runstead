# Work Packs

Work Pack is the user-facing unit for reusable AI work. It gives one name to
the pieces that were previously described separately:

- a **domain pack** declares the workflow shape, task types, default policy,
  verifiers, maturity metadata, fixtures, and evals
- an **extension** adds source collectors, verifiers, and gates for a workspace
  or provider integration
- a **skill** adds reusable worker guidance and tool permissions for a bounded
  task family

The Work Pack model does not replace those layers. It is the composition layer
that lets users think in one object:

```text
Work Pack = domain pack + optional extensions + optional skills
```

## Shape

Every Work Pack has:

- `id`, `name`, `version`, and `description`
- one `domain_pack` component
- zero or more `extension` components
- zero or more `skill` components
- workflows derived from the domain pack's `goal_templates` and `task_types`
- resource types and supported workers inherited from the domain pack

The current built-in packs are domain-backed Work Packs. For example,
`research-monitor` exposes `weekly-research-digest` as a goal-template
workflow and `scan_sources`, `summarize_findings`, and other task-type
workflows under the same Work Pack id.

## Why This Layer Exists

Without Work Packs, a user has to learn three nouns before they know what they
can run:

- "domain pack" for workflow contracts
- "extension" for data collection and gates
- "skill" for worker behavior

With Work Packs, those details remain visible for authors, but operators get a
single mental model: choose a pack, choose a workflow, then Runstead applies the
pack's connectors, policy, evidence contract, and worker guidance.

## Current Implementation

`@runstead/domain-packs` exports a `WorkPack` schema and helpers that project
any domain pack into a Work Pack:

- `domainPackToWorkPack(domain)`
- `domainPackRegistryEntryToWorkPack(entry)`

`runstead domain show <pack>` now reports Work Pack workflows and components so
operators can inspect the unified shape before running work.

## Run Surface

Use `runstead run <pack> <workflow>` as the canonical entry point for Work Pack
execution:

```bash
runstead run ai-native-startup build-mvp
runstead run repo-maintenance keep-ci-green
runstead run research-monitor weekly-research-digest
runstead run email-followup draft-pending-followups
```

This surface resolves the pack, installs it into `.runstead/domains` when
needed, queues the workflow's generated tasks, executes those tasks in workflow
order, and reports both execution status and evidence-contract status. The
workflow executor uses the pack's task-type routing instead of hard-coded task
names, so custom domain task types can run through command verifiers, repository
inspection evidence, governed local agents, manual-evidence blocks, or approval
pauses according to their declared contract.

Use `--plan` to preview the capability policy, evidence outputs, completion
criteria, connector readiness, workspace extension readiness, and suggested
commands without queuing or executing:

```bash
runstead run ai-native-startup build-mvp --plan
```

Use `--max-tasks <count>` to stop after a bounded number of workflow tasks. This
is useful for approval-heavy packs where the first task may intentionally pause
before a worker starts.

The older `runstead run --once` queue executor remains available for existing
local tasks and daemon-driven queues.

Work Pack plans load `.runstead/extensions/` manifests for the selected domain
and report whether each extension is executable (`ready`), missing declared
secrets (`missing_secrets`), only a non-executable contract (`contract_only`),
or declared by the Work Pack but absent from the workspace (`missing`).
