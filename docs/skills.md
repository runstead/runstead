# Skills

Skill packages are still experimental, isolated from the default MVP readiness
path, and not part of `startup ready`. A candidate can be created, validated,
tested, and then manually promoted only after its package tests pass:

```sh
runstead skill candidate create fix-pnpm-ci-failures \
  --description "Diagnose pnpm CI failures" \
  --trigger ci_failure \
  --allowed-tool filesystem.read \
  --denied-tool secret.read \
  --verifier-command "pnpm test" \
  --task task_001

runstead skill validate ./skills/fix-pnpm-ci-failures
runstead skill test ./skills/fix-pnpm-ci-failures
runstead skill promote ./skills/fix-pnpm-ci-failures --promoted-by maintainer
runstead skill deprecate ./skills/fix-pnpm-ci-failures \
  --deprecated-by maintainer \
  --reason "superseded by a safer workflow"
```

Promotion updates `skill.yaml` from `candidate` to `promoted`, appends the
promotion decision to `changelog.md`, and does not attach the skill to future
tasks. Deprecation updates `skill.yaml` from `promoted` to `deprecated` and
records the reason in `changelog.md`.

## Experimental Automatic Improvement

The automatic improvement loop is a secondary operator-triggered path. It can
turn quarantined `skill_candidate` learning proposals into activated,
repo-scoped skills when they pass the low-risk auto-promotion gate, but it is
not run by startup readiness or included in readiness verdict inputs:

```sh
runstead learning auto-improve \
  --cwd /path/to/repo \
  --scope repo \
  --risk low \
  --canary 25
```

The automatic path is intentionally constrained:

- only quarantined `skill_candidate` proposals are eligible
- operators must invoke `runstead learning auto-improve`; readiness runs do not
  invoke it
- low-risk auto-promotion requires repo scope, `skill_test`, and no high-impact
  allowed tools such as secrets, external writes, dependency updates, policy
  writes, deployments, pushes, or PR creation
- generated skill packages still run `skill validate`, `skill test`, and
  `skill promote`
- activated skills are registered in `.runstead/skills/activations.json`
- local-agent prompts receive only matching active skills for the same repo,
  task type, mode, and canary bucket
- every activation, context retrieval, task outcome, and rollback is audited in
  the Runstead event log

Shadow mode is the recommended first rollout step. It promotes and registers a
skill without injecting it into prompts:

```sh
runstead learning auto-improve --cwd /path/to/repo --shadow
```

List and manually disable activated skills:

```sh
runstead skill activation list --cwd /path/to/repo
runstead skill activation deactivate <activation-id> \
  --cwd /path/to/repo \
  --reason "regressed verifier pass rate"
```

When `rollbackOnRegression` is enabled, Runstead automatically disables an
activated skill after a later task that used it ends in `failed`, `blocked`, or
`interrupted`.

Skill package validation fails closed when required package files are
symlinks or resolve outside the package root. Keep `skill.yaml`,
`SKILL.md`, `permissions.yaml`, `tests/run.sh`, and `rollback.md` as
regular files inside the package so promotion cannot smuggle instructions,
tests, or rollback notes from another location.

The skill surface is intentionally smaller than the SDK extension surface:

- skills wrap an automatable troubleshooting recipe with permissions and a
  rollback note
- `@runstead/sdk` extension manifests wrap readiness facets, evidence
  collectors, verifiers, and gates that the startup readiness engine
  consumes

Choose skills for "this is how I fix X when it happens" workflows, and
extensions for "this is how I prove X is ready before I launch" workflows.
See [capability-boundaries.md](capability-boundaries.md) for the full boundary
between domain packs, extensions, skills, connectors, and tools.

## Readiness Metadata

Skill packages can declare Hermes-style readiness metadata in `skill.yaml` so
Runstead can explain whether an activated skill is usable for a Work Pack run:

```yaml
readiness:
  platforms: [linux, macos]
  required_env:
    - name: DOCS_API_TOKEN
      purpose: archive digest evidence
  required_connectors: [docs]
  required_tools: [filesystem.read]
  required_workers: [codex_cli]
  fallback_for_connectors: [web]
  fallback_for_tools: [browser.navigate]
```

`runstead run <pack> <workflow> --plan` reports activated skill readiness next
to connector and extension readiness:

- `ready`: platform, env, connector, tool, and worker requirements are present
- `missing_requirements`: one or more declared requirements are absent
- `fallback_suppressed`: the skill is a fallback and a primary connector or
  tool is already available
- `platform_unsupported`: the skill does not support the current platform
- `disabled`: the activation exists but is disabled
- `missing`: the Work Pack declares a skill component, but no matching
  activation is loaded
