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
- governed filesystem read/write proxy
- governed GitHub, git, checkpoint, and wrapped-worker actions in CI repair
- ordered audit timelines for replaying governed task lifecycles

Use `runstead audit replay <task-id>` to reconstruct a task lifecycle from the
append-only event log. Replay follows related worker run, tool call, policy
decision, approval, evidence, and task ids instead of requiring each aggregate
filter to be selected manually.

The product rule is strict: every side effect must be allowed, denied, or
attached to an approval request before it runs.

Some ad-hoc CLI helpers are still explicitly labeled unmanaged. They are useful
for local diagnosis, but the product path is the governed runtime and CI repair
orchestrator.

Wrapped external workers run in `policy_gated_wrapper` mode: Runstead gates the
worker launch, records the action envelope and policy decision, starts the
worker with native sandbox or permission guardrails, checkpoints the workspace,
verifies diff scope and command evidence after the worker exits, and audits the
result. It does not yet fully hard-proxy each tool call made inside the external
worker process.

Mutating unmanaged helpers now require explicit acknowledgement with
`--unmanaged`:

- `runstead checkpoint restore`
- `runstead github pr create`
- `runstead git branch create`

Use the governed CI repair path for normal repo-maintenance work. The flag is a
local escape hatch, not a policy decision or approval grant.
