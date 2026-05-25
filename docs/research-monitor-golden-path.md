# Research Monitor Golden Path

`research-monitor` is a maturity-gated built-in domain pack. It proves that
Runstead's pack model can support a non-startup workflow with evidence,
policy, fixtures, and eval contracts.

## Workflow

The weekly digest path is:

1. `discover_sources`
2. `scan_sources`
3. `evaluate_source_reliability`
4. `summarize_findings`
5. `triage_source_conflicts`
6. `prepare_digest_release`
7. `archive_research_memory`

The pack treats webpage content, PDF text, and snippets as untrusted input.
It allows read-only source discovery and evidence records, but publishing
or external sends remain approval-gated.

## Evidence Gates

Digest readiness requires:

- source inventory with discovery queries
- retrieval timestamps and freshness checks
- source reliability scores
- citations for every material claim
- contradiction review with uncertainty markers
- publish approval evidence before external distribution
- archive records for durable claim ids, source ids, and follow-up
  questions

## Local Validation

Validate the pack:

```sh
runstead domain validate packages/domain-packs/packs/research-monitor
runstead domain maturity packages/domain-packs/packs/research-monitor
```

The built-in fixtures cover:

- `source-discovery-review`
- `source-reliability-review`
- `weekly-research-digest-smoke`
- `conflicting-sources-regression`
- `publish-gate-review`
- `archive-memory-update`

The fixture data is intentionally local and credential-free. It is
designed to test pack contracts, not to fetch live research sources.

## Why It Matters

Two mature built-in packs are enough to demonstrate that:

- the pack contract is general (it covers startup readiness **and** a
  research workflow that has nothing to do with code)
- the verifier, evidence, and policy primitives in `@runstead/runtime`,
  `@runstead/verifiers`, `@runstead/evidence`, and `@runstead/governance`
  are not specific to repo-maintenance work
- fixtures and evals can prove pack stability without requiring real
  external services
