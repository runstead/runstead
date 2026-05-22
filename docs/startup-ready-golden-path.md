# Startup Ready Golden Path

This is the repo-local dogfood path for the todo MVP fixture. It demonstrates
Runstead's intended product shape: one readiness command, a bounded worker, auto
verifiers, UI smoke, launch reports, complete-check, and a target-aware verdict.

## Fixture

The fixture lives at:

```text
packages/domain-packs/packs/ai-native-startup/fixtures/tiny-todo
```

It includes:

- a small todo domain module
- a local HTTP UI with `Todo MVP` and `Add task`
- `test`, `lint`, `typecheck`, `build`, and `dev` package scripts
- a minimal GitHub Actions workflow

## Run It

Copy the fixture to a throwaway workspace:

```bash
cp -R packages/domain-packs/packs/ai-native-startup/fixtures/tiny-todo /tmp/runstead-todo
```

Run readiness:

```bash
runstead startup ready \
  --cwd /tmp/runstead-todo \
  --stage launch \
  --worker codex_cli \
  --target local
```

Runstead should:

- initialize `.runstead/`
- generate `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and measurement files
- run the bounded MVP worker loop
- run discovered verifier commands
- start the local dev server and execute UI smoke
- generate launch readiness and complete-product reports
- write `startup-readiness-run-<run-id>.md`
- return `local_launch_ready` or explicit blockers

## Plan, CI, Resume

Planner only:

```bash
runstead startup ready --cwd /tmp/runstead-todo --stage launch --target local --plan
```

Generate CI workflow:

```bash
runstead startup ready --cwd /tmp/runstead-todo --write-ci
```

CI artifact mode:

```bash
runstead startup ready --cwd /tmp/runstead-todo --stage launch --target local --ci
```

Resume:

```bash
runstead startup ready --cwd /tmp/runstead-todo --resume <run-id>
```

## Reading The Result

The durable run state is:

```text
.runstead/startup/readiness-runs/<run-id>.json
```

The primary decision report is:

```text
.runstead/reports/startup-readiness-run-<run-id>.md
```

For a local target, synthetic UI smoke and local command evidence are enough to
make a local decision. They are not enough for public launch. A production
target should stay blocked until CI, production deployment, real-user
analytics, support or feedback triage, security, rollback, and observability
evidence are recorded.
