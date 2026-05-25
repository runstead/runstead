# Verifier

Runstead completion is verifier-first. A task is not complete because a
worker claims success; it is complete when verifier evidence says it
passed.

## Verifier Path

The verifier path supports:

- deterministic shell command verifiers
- policy decisions before verifier command execution
- command output evidence artifacts under `.runstead/evidence/`
- policy-block evidence for denied or approval-required commands
- diff scope verification for CI repair worker changes
- no-empty-diff enforcement before CI repair publishing
- GitHub workflow run log evidence for CI repair intake
- PR evidence summaries generated from task and verifier output
- per-target launch evidence requirements computed by
  `@runstead/runtime`'s readiness verdict engine
- extension-contributed verifier commands declared in
  `.runstead/extensions/*.yaml`

Auxiliary model review may be added in the future, but it must not be the
only required verifier.

## Standard Verifiers

`@runstead/verifiers` declares the standard verifier names that the
runtime, repair loops, and startup readiness all agree on:

- `test`
- `lint`
- `typecheck`
- `build`

`CommandVerifierInputSchema` defines the shape of every verifier command
(`name`, `command`), and `STANDARD_VERIFIER_NAMES` plus
`isStandardVerifierName` let callers distinguish standard verifiers from
custom ones without importing CLI internals.

## Evidence Layout

Verifier evidence artifacts live under:

```
.runstead/evidence/<evidence-id>.json
.runstead/evidence/<evidence-id>.stdout
.runstead/evidence/<evidence-id>.stderr
```

Each is referenced from the evidence row in the state store, including the
command, exit code, timeout/forceKilled flags, code-state fingerprint, and
the policy decision and approval id used to permit the command.

## Verifier-Only Recovery

Startup readiness compares the current code-state fingerprint with the
fingerprint recorded against each verifier evidence row. When the agent
worker reports a failure but every required verifier already has passing
evidence for the current fingerprint, the run finalizes as
`completed_with_warnings` rather than `failed`. The same comparison powers
the green path that skips the worker entirely on unchanged code.

## Extension Verifiers

Extensions declared under `.runstead/extensions/` can contribute additional
verifier commands. Compiled by `@runstead/sdk`'s
`compileRunsteadExtensionRuntime`, they are appended to the discovered
test/lint/typecheck/build list and run through the same verifier
infrastructure. Extension-contributed verifiers also carry `evidenceTier`
and `producesEvidenceTypes`, which feed back into the readiness verdict
engine.

## Diff Scope

For CI repair, every worker run is followed by `git diff --name-only`
against the planned base. Any file outside the allowed scope or matching a
denied path becomes a diff-scope violation that blocks publish, even if the
verifier commands passed. This is intentional: passing tests on changes
that violate the worker's path scope are not safe to merge automatically.

## CI Summary And Release Decision

The CI summary writes a markdown summary, JSON artifact, GitHub Check
summary payload, and PR comment body. It also persists a release decision
computed by `compileReadinessReleaseDecision`:

- `allow_release` when the target readiness verdict is ready, gate blockers
  are superseded or already clear, and external checks (remote GitHub
  Actions, additional `ReadinessExternalCheck` entries) are not failing or
  pending
- `block_release` otherwise

Superseded gate blockers are recorded explicitly when the readiness verdict
overrides a stale gate blocker, so audit consumers can see which blockers
were dropped and why.
