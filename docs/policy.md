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
- governed GitHub, git branch/commit/push, checkpoint, and wrapped-worker actions in CI repair
- native worker and model inference action contracts for future tool-proxied workers
- ordered audit timelines for replaying governed task lifecycles

Use `runstead audit replay <task-id>` to reconstruct a task lifecycle from the
append-only event log. Replay follows related worker run, tool call, policy
decision, approval, evidence, and task ids instead of requiring each aggregate
filter to be selected manually.

CI repair task output keeps separate runtime counters for orchestration
attempts, wrapped-worker attempts, publish attempts, interrupted-run resumes,
and approval rounds. These counters are separate from the task-level
`attempt` field so crash resume, worker retry, and approval retry can be
reported independently.

The product rule is strict: every side effect must be allowed, denied, or
attached to an approval request before it runs.

`runstead init` writes the safe default policy profile, which requires approval
before starting an external wrapped worker. `runstead init --profile
trusted-local` is for trusted local workstations: it allows the built-in
`codex_cli` and `claude_code` wrapped workers for that repo, but still requires
approval for dependency changes and publishing, and still denies protected
paths.

Policy rules can also match action metadata such as `risk_class`. `codex_direct`
uses this for scaffold-aware MVP runs: a `filesystem.patch` is marked
`scaffold_app_patch` only when every touched file is inside the task's
app-owned scaffold paths. Trusted-local policy can allow that narrow class while
dependency files, secrets, and `.runstead/**` remain approval-gated or denied.

Some ad-hoc CLI helpers are still explicitly labeled unmanaged. They are useful
for local diagnosis, but the product path is the governed runtime and CI repair
orchestrator.

Wrapped external workers run in `policy_gated_wrapper` mode. Runstead currently
provides Level 1 wrapped execution for external coding agents: it gates the
worker launch, records the action envelope and policy decision, starts the
worker with native sandbox or permission guardrails, checkpoints the workspace,
commits worker changes through a governed `git.commit` action, verifies diff
scope and command evidence after the worker exits, and audits the result. Full
Level 2 tool-proxied execution, where every internal worker tool call passes
through Runstead, is future work. The worker governance manifest records this
as `internalToolProxy.mode: none`; callers that require `hard_proxy`
enforcement fail before the external worker process is launched.

Native workers use a separate `worker.native.start` action contract. The
contract is reserved for Runstead-owned worker loops whose internal tool calls
are routed through governed actions such as `filesystem.read`,
`filesystem.write`, `shell.exec`, `git.status`, and `git.diff`. Model calls use
`model.inference.request`, which records `network_write_external` and
`llm_data_egress` side effects. The default policy requires approval for both
contracts. `runstead init --profile trusted-local` may allow the built-in
`codex_direct` worker and trusted model provider resources such as
`chatgpt_codex`, `openai`, `openrouter`, `anthropic`, `gemini`, local
OpenAI-compatible endpoints, and other bundled provider ids. The selected
provider id is recorded in the policy decision for each model request. Protected
paths, dependency changes, publishing, and other external writes still keep
their stricter rules. Run `runstead upgrade` in older trusted-local workspaces
to merge newly supported provider resource ids into the policy allowlist.

Mutating unmanaged helpers now require explicit acknowledgement with
`--unmanaged`:

- `runstead checkpoint restore`
- `runstead github pr create`
- `runstead git branch create`

Use the governed CI repair path for normal repo-maintenance work. The flag is a
local escape hatch, not a policy decision or approval grant.
