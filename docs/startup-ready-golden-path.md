# Startup Ready Golden Path

This is the repo-local dogfood path for the todo MVP fixture. It demonstrates
Runstead's intended product shape: one readiness command, a bounded worker,
auto verifiers, UI smoke with bounded auto-repair, launch reports,
complete-check, a target-aware verdict, and a local operator console.

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

Run the fast local readiness path:

```bash
runstead startup ready \
  --cwd /tmp/runstead-todo \
  --stage launch \
  --target local \
  --worker codex_cli \
  --governance readiness
```

Runstead should:

- initialize `.runstead/`
- generate `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and measurement files
- run the bounded MVP worker loop, **or skip the worker** when the existing
  app surface already has test/lint/typecheck/build commands and matching
  verifier evidence (green path)
- run discovered verifier commands
- start the local dev server and execute UI smoke
- auto-repair UI smoke failures classified as `product_gap` or
  `selector_unstable` within a bounded retry budget
- generate launch readiness and complete-product reports
- write `startup-readiness-run-<run-id>.md` and the run JSON snapshot
- return `local_launch_ready` or explicit blockers

For the existing `tiny-todo` fixture, `codex_cli` is enough for the fast Level 1
readiness wrapper because Runstead can prove the repo through command verifier
and UI smoke evidence. Use `--worker codex_direct --governance governed` when
the fixture is meant to exercise the Level 2 native proxy boundary.

## Empty Repo Dogfood

The live dogfood path used for the todo example is an empty repo that
Runstead turns into a local-first todo MVP:

```text
/Users/Michael.Lin/Sites/temp/todo
https://github.com/leapvoid/todo
```

Run the governed scaffold path with `codex_direct`:

```bash
runstead startup ready \
  --cwd /Users/Michael.Lin/Sites/temp/todo \
  --stage launch \
  --target local \
  --worker codex_direct \
  --governance governed \
  --app-template static-todo \
  --app-type local-first-web
```

For an empty repo, the scaffold profile is written to:

```text
.runstead/startup/scaffold-profile.json
```

The profile tells the worker to build a dependency-light static todo app,
provide `test`, `lint`, `typecheck`, `build`, and `start` scripts, persist
data in `localStorage`, and expose stable UI smoke selectors such as
`data-testid=new-todo-input` and `data-testid=add-todo`.

With `codex_direct`, filesystem and shell tool calls go through Runstead
policy. The first scaffold write approval is **scoped until expiry** and
reused for safe app files in the same task, while dependency, secret,
`.git`, `.runstead`, and protected-path writes stay strictly outside that
grant.

If UI smoke fails with a `product_gap` or `selector_unstable` category,
`startup ready` writes a structured repair-request artifact:

```text
.runstead/startup/ui-smoke-repair-<run-id>.json
```

It then runs one bounded MVP repair attempt and reruns UI smoke. Browser
runtime and network failures are not auto-repaired (they are not product
defects). A passing local run ends as `local_launch_ready`. That verdict
covers local demo and operator validation only. If the repo has no initial
commit, or the remote repo is private or unauthenticated, remote GitHub
Actions can be recorded as
`remote_ci_not_applicable_until_initial_commit`, `not_configured`, or
`unknown`; that does not block a local target unless the requested target
requires remote CI evidence.

## Plan, CI, Resume, Force-Build

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

Resume after interruption:

```bash
runstead startup ready --cwd /tmp/runstead-todo --resume <run-id>
```

Force the worker even when the green path would skip it:

```bash
runstead startup ready --cwd /tmp/runstead-todo --force-build
runstead startup ready --cwd /tmp/runstead-todo --repair       # alias
```

Recover tasks abandoned by a previous crash:

```bash
runstead resume --cwd /tmp/runstead-todo
```

## Dashboard And Operator Console

Read-only dashboard:

```bash
runstead dashboard serve --cwd /tmp/runstead-todo
```

The dashboard shows the latest readiness run, a run-comparison timeline
(latest completed vs latest blocked, resolved blockers, still-blocked
items), pending approvals, stale evidence count, blockers, resume command,
and recommended next command. The same action queue is available as JSON at
`/operator-actions.json`.

Mutating Operator API (opt-in):

```bash
runstead dashboard serve --cwd /tmp/runstead-todo --enable-operator-api
```

Runstead prints a session token and CSRF token; both are required on every
mutating request. The server only accepts local addresses and rejects
cross-origin requests.

## Artifact Hygiene

```bash
runstead startup artifact hygiene --cwd /tmp/runstead-todo --retention-days 30
```

This writes `.runstead/startup/latest-artifacts.json`,
`.runstead/reports/startup-artifact-hygiene.md`, and a JSON report that
separates current, referenced, superseded, and unreferenced artifacts. Add
`--prune` only when you want Runstead to delete unreferenced artifacts older
than the retention window.

## Reading The Result

The durable run state is:

```text
.runstead/startup/readiness-runs/<run-id>.json
```

The primary decision report is:

```text
.runstead/reports/startup-readiness-run-<run-id>.md
```

For a local target, synthetic UI smoke and local command evidence are
enough to make a local decision. They are not enough for public launch. A
production target should stay blocked until CI, production deployment,
real-user analytics, support or feedback triage, security, rollback,
rollback drill, observability, monitoring alerts, error budget, migration
validation, traffic gate, and post-launch watch evidence are recorded.

External evidence can be attached through source connector contracts:

```bash
runstead startup source list
runstead startup source record \
  --cwd /tmp/runstead-todo \
  --connector github_actions \
  --target staging \
  --source-uri https://github.com/acme/todo/actions/runs/1 \
  --summary "CI passed" \
  --status passed
runstead startup source collect \
  --cwd /tmp/runstead-todo \
  --connector github_actions \
  --target staging \
  --github-repo acme/todo \
  --github-run-id 1
runstead startup source collect \
  --cwd /tmp/runstead-todo \
  --connector vercel \
  --target staging \
  --vercel-deployment dpl_123
runstead startup source verify \
  --cwd /tmp/runstead-todo \
  --connector vercel \
  --target staging \
  --source-uri https://todo-preview.vercel.app/health \
  --expect-status 200 \
  --expect-text "ok"
```

## Extension Smoke

Drop a copy of the example PostHog extension into the fixture:

```bash
mkdir -p /tmp/runstead-todo/.runstead/extensions
cp docs/examples/extensions/posthog-activation.yaml /tmp/runstead-todo/.runstead/extensions/
cp -R docs/examples/extensions/fixtures /tmp/runstead-todo/.runstead/extensions/
```

The example collector command points at the local fixture and emits
deterministic JSON evidence. A `--plan` run previews what would execute
without running the collector or making real API calls.
