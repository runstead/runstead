# Email Follow-up Golden Path

The `email-followup` domain pack is draft-only by design. It helps an operator
triage threads and prepare follow-up drafts, but it must not send email.

## Pack Shape

The pack models a complete follow-up loop:

1. `scan_threads`: read mailbox threads and list candidates.
2. `classify_followup_need`: record follow-up reason, priority, and risk flags.
3. `verify_recipients`: check recipient identity, role, opt-out status, and
   ambiguity.
4. `draft_followup`: create a draft preview with recipient and factual support
   evidence.
5. `review_draft_safety`: review tone, claims, attachments, and send boundary.
6. `archive_followup_memory`: record owner, next action, reminder date, and
   durable follow-up status.

The default policy allows read, contact lookup, draft creation, and follow-up
memory updates. It denies `email.send`, `email.reply.send`, and any
`send_message_external` side effect.

## Expected Evidence

Useful readiness evidence includes:

- mailbox access stayed read-only
- follow-up reasons and priorities were recorded
- recipient identity and opt-out status were checked
- draft preview was attached
- tone and factual-risk review was completed
- no send action was performed
- human approval remains required before sending
- follow-up memory was updated without storing full email bodies or secrets

## Validation

Run pack validation directly:

```bash
pnpm --filter @runstead/domain-packs test
```

The built-in fixtures cover thread triage, recipient safety, draft-only smoke,
send-block regression, and durable follow-up memory.
