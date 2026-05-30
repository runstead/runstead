# Non-Startup Domain Golden Paths

Runstead's domain pack contract is not startup-specific. The two non-startup
golden paths below exercise the same pack surfaces: task types, policy,
evidence gates, fixtures, evals, report sections, and maturity checks.

## Research Monitor

Use `research-monitor` for recurring cited research digests:

```sh
runstead domain show research-monitor
runstead domain validate packages/domain-packs/packs/research-monitor
runstead domain maturity packages/domain-packs/packs/research-monitor
runstead run research-monitor weekly-research-digest --plan
```

The golden path is:

1. discover source candidates and inventory gaps
2. scan sources with retrieval timestamps and freshness windows
3. assess reliability, independence, and primary-source status
4. summarize claims with citations
5. triage contradictory claims and uncertainty markers
6. prepare a publish-gated digest release
7. archive durable claim ids, source ids, and follow-up questions

Expected proof:

- 7 task types in the pack
- 6 fixtures and 6 eval benchmarks
- report sections for source coverage, source reliability, claim quality,
  distribution readiness, and research memory
- maturity result `passed (100%)`

## Email Follow-Up

Use `email-followup` for draft-only inbox follow-ups:

```sh
runstead domain show email-followup
runstead domain validate packages/domain-packs/packs/email-followup
runstead domain maturity packages/domain-packs/packs/email-followup
runstead run email-followup draft-pending-followups --plan
```

The golden path is:

1. scan mailbox threads without mutating messages
2. classify follow-up reason, priority, and risk flags
3. verify recipient identity, role, ambiguity, consent, and opt-out status
4. create a draft preview without sending
5. review tone, claims, attachments, and send boundary
6. archive follow-up memory with owner, next action, and reminder date

Expected proof:

- 6 task types in the pack
- 5 fixtures and 5 eval benchmarks
- report sections for thread triage, recipient safety, draft quality,
  send boundary, and follow-up memory
- `email.send`, `email.reply.send`, and external send side effects denied by
  default policy
- maturity result `passed (100%)`

## Regression Gate

Run the shared validation before changing pack contracts:

```sh
pnpm --filter @runstead/domain-packs test
pnpm --filter @runstead/cli exec vitest run src/domain-pack-command.test.ts
pnpm --filter @runstead/cli exec vitest run src/work-pack-run.test.ts
```

These tests make the non-startup proof executable instead of relying only on
documentation.
