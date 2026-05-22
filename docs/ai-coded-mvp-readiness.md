# AI-Coded MVP Readiness Runbook

This runbook is the practical end-to-end path for using Runstead with an
AI-coded MVP. It is intentionally evidence-first: the goal is not merely to make
an agent write code, but to prove what is ready, what is missing, and what risk
remains.

## 1. Onboard The Repository

Run this in an empty or existing product repository:

```bash
runstead startup onboard \
  --cwd /path/to/mvp \
  --write-ci
```

Expected output:

- `.runstead/` control-plane state
- startup domain pack
- agent context files such as `AGENTS.md`, `CLAUDE.md`, and `CODEX.md`
- `MEASUREMENT.md` and structured measurement framework
- GitHub Actions verifier workflow when `--write-ci` is used

## 2. Build Or Repair The MVP

Default to `codex_cli`:

```bash
runstead startup build-mvp \
  --cwd /path/to/mvp \
  --worker codex_cli \
  --dependency-policy deny-new \
  --prompt "Build the MVP and satisfy test, lint, typecheck, and build."
```

Use `deny-new` for a baseline MVP when the user wants a local-first,
dependency-free or dependency-stable implementation.

Use `codex_direct` only when strict tool-call governance is needed:

```bash
runstead agent run \
  --cwd /path/to/mvp \
  --worker codex_direct \
  --mode repair \
  --max-turns 40 \
  --max-tool-calls 100 \
  --max-failed-tool-calls 8 \
  --denied ".git/**" \
  --denied ".runstead/**" \
  --verifier "test=npm test" \
  --verifier "lint=npm run lint" \
  --verifier "typecheck=npm run typecheck" \
  --verifier "build=npm run build" \
  "Repair the repository contract without adding dependencies."
```

## 3. Verify The Product Contract

Run the product's local contract directly:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Attach the same result to the Runstead verifier task:

```bash
runstead task list --cwd /path/to/mvp
runstead verifier run <run_mvp_verifiers-task-id> --cwd /path/to/mvp
```

The direct command output is useful for local confidence. The Runstead verifier
record is useful for gate and report confidence.

## 4. Record MVP Hypotheses And Validation

Runstead expects the MVP gate to know what the product is trying to prove:

```bash
runstead startup hypothesis add \
  --cwd /path/to/mvp \
  --kind problem \
  --statement "..." \
  --status validated \
  --source "..."

runstead startup hypothesis add \
  --cwd /path/to/mvp \
  --kind user \
  --statement "..." \
  --status validated \
  --source "..."

runstead startup hypothesis add \
  --cwd /path/to/mvp \
  --kind solution \
  --statement "..." \
  --status validated \
  --source "..."
```

Also record disconfirming evidence. For a local example, this may be a manual
risk note. For a real launch, it should include customer or market evidence.

```bash
runstead startup evidence add \
  --cwd /path/to/mvp \
  --type disconfirming \
  --summary "..." \
  --source-kind manual \
  --gate mvp
```

Check the MVP gate:

```bash
runstead startup gate check --cwd /path/to/mvp --stage mvp
```

## 5. Record UI Evidence

Use Runstead's built-in DOM/UI validation for a local or deployed URL:

```bash
runstead startup launch ui-validate \
  --cwd /path/to/mvp \
  --execute \
  --server-command "npm run dev" \
  --server-port 3000 \
  --url http://127.0.0.1:3000 \
  --expect-text "..." \
  --flow "primary activation flow" \
  --flow-status pass
```

For interactive products, also run a real browser smoke outside Runstead when
needed. Then record the result as metric or deployment evidence.

## 6. Record Measurement Evidence

When no production analytics exists yet, use a low-confidence synthetic smoke
metric and say so:

```bash
runstead startup measurement snapshot \
  --cwd /path/to/mvp \
  --metric activation_flow_completion \
  --source "local browser smoke" \
  --source-uri http://127.0.0.1:3000 \
  --source-kind browser_ui \
  --source-class synthetic_smoke \
  --confidence 0.55 \
  --threshold 1 \
  --current 1 \
  --unit flow \
  --window local-smoke \
  --cohort local-founder-qa \
  --trend flat \
  --false-positive "Synthetic smoke is not real-user demand evidence."
```

Before public launch, replace this with real analytics or source evidence when
possible.

## 7. Prepare Launch Evidence

Generate repo and security readiness:

```bash
runstead startup launch audit --cwd /path/to/mvp
runstead startup launch security-baseline --cwd /path/to/mvp
runstead startup launch git-summary --cwd /path/to/mvp
```

Record required launch plans with owner, task, and acceptance criteria:

```bash
runstead startup evidence add \
  --cwd /path/to/mvp \
  --type migration_plan \
  --summary "..." \
  --source docs/migration-plan.md \
  --source-kind manual \
  --gate launch \
  --owner founder \
  --remediation-task "..." \
  --acceptance-criteria "..."

runstead startup evidence add \
  --cwd /path/to/mvp \
  --type rollback_plan \
  --summary "..." \
  --source docs/rollback-plan.md \
  --source-kind manual \
  --gate launch \
  --owner founder \
  --remediation-task "..." \
  --acceptance-criteria "..."

runstead startup evidence add \
  --cwd /path/to/mvp \
  --type observability \
  --summary "..." \
  --source docs/observability.md \
  --source-kind manual \
  --gate launch \
  --owner founder \
  --remediation-task "..." \
  --acceptance-criteria "..."
```

Record release and deployment evidence:

```bash
runstead startup evidence add \
  --cwd /path/to/mvp \
  --type release_plan \
  --summary "..." \
  --source docs/release-plan.md \
  --source-kind manual \
  --gate launch \
  --owner founder \
  --remediation-task "..." \
  --acceptance-criteria "..."

runstead startup source record \
  --cwd /path/to/mvp \
  --connector deployment \
  --source-uri http://127.0.0.1:3000 \
  --summary "Local preview deployment smoke passed." \
  --status pass \
  --trust medium \
  --payload '{"environment":"local-preview","production":false}'
```

Local preview deployment evidence can satisfy the local complete-check mechanics,
but it should be labeled as non-production.

## 8. Prepare Scale Evidence

For scale readiness, generate or record the operating artifacts:

```bash
runstead startup launch bottleneck-map \
  --cwd /path/to/mvp \
  --bottleneck "..." \
  --owner founder \
  --system-of-record "..." \
  --handoff-due 2026-06-05

runstead startup scale workflow-registry \
  --cwd /path/to/mvp \
  --workflow "Weekly verifier and browser smoke before release" \
  --delegation-rule "..." \
  --approval-boundary "..."

runstead startup scale memory-capture \
  --cwd /path/to/mvp \
  --knowledge "..." \
  --source README.md

runstead startup scale integration-map \
  --cwd /path/to/mvp \
  --integration "..."

runstead startup scale sop-generate \
  --cwd /path/to/mvp \
  --owner founder \
  --workflow "..." \
  --sop "..."

runstead startup launch support-triage \
  --cwd /path/to/mvp \
  --request "..." \
  --outcome "..."

runstead startup scale gtm-verify \
  --cwd /path/to/mvp \
  --claim "..." \
  --evidence README.md \
  --product-state "..."

runstead startup scale schedule-report \
  --cwd /path/to/mvp \
  --cadence weekly \
  --owner founder \
  --next-run 2026-05-29

runstead startup scale report \
  --cwd /path/to/mvp \
  --period 2026-W21
```

## 9. Final Gates And Reports

Run the checks in this order:

```bash
runstead startup gate check --cwd /path/to/mvp --stage mvp
runstead startup launch-check --cwd /path/to/mvp
runstead startup gate check --cwd /path/to/mvp --stage scale
runstead startup launch report --cwd /path/to/mvp --print
runstead startup complete-check --cwd /path/to/mvp --print
```

The complete check should be treated as the final local review surface. A
`complete` result means Runstead has enough local evidence to accept the current
state. It does not mean the product has real production users, production
analytics, or production deployment proof unless those sources were recorded.

## 10. Real Launch Upgrade Path

Before a real public launch, replace local/synthetic evidence with:

- pushed commits and remote CI run evidence
- real deployment URL evidence
- production health and security header evidence
- analytics or database-backed activation metrics
- support issue or feedback evidence
- customer interview or real validation evidence
- explicit accepted-debt records for anything intentionally deferred
