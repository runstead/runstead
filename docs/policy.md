# Policy

Policy decisions must be based on structured action envelopes, not natural
language. Runstead now has a deterministic policy path for the main local
verifier and CI repair flows:

- action envelope schema
- policy DSL parser with load-time validation
- deterministic evaluator with deny > approval > allow precedence
- risk scorer
- approval request model and reusable approval grants
- tool contract registry
- shell verifier guard
- governed GitHub, git, checkpoint, and wrapped-worker actions in CI repair

The product rule is strict: every side effect must be allowed, denied, or
attached to an approval request before it runs.

Some ad-hoc CLI helpers are still explicitly labeled unmanaged. They are useful
for local diagnosis, but the product path is the governed runtime and CI repair
orchestrator.

Mutating unmanaged helpers now require explicit acknowledgement with
`--unmanaged`:

- `runstead checkpoint restore`
- `runstead github pr create`
- `runstead git branch create`

Use the governed CI repair path for normal repo-maintenance work. The flag is a
local escape hatch, not a policy decision or approval grant.
