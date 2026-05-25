# Policy

Policy decisions are based on structured action envelopes, not natural
language. The deterministic policy path covers the main local verifier,
agent, repair, and readiness flows:

- `ActionEnvelope` schema with `actionType`, `resource`, and `context`
  (cwd, command, filesTouched, diffHash, dependencyImpact, riskClass,
  pendingPatch, canonicalSignature, networkDomains, sideEffects)
- policy DSL parser with load-time validation
- deterministic evaluator with **deny > require_approval > allow** precedence
- risk scorer that ranks `policyResult.risk` against action-type and
  side-effect risk and returns the highest
- approval request model with reusable approval grants
- tool contract registry (`@runstead/tools`)
- shell verifier guard
- governed filesystem read/write/patch proxy with workspace path
  normalization (rejects symlink and `..` traversal outside the workspace)
- governed GitHub, git branch/commit/push, checkpoint, and wrapped-worker
  actions in CI repair
- native worker (`worker.native.start`) and model inference
  (`model.inference.request`) action contracts
- ordered audit timelines for replaying governed task lifecycles

Use `runstead audit replay <task-id>` to reconstruct a task lifecycle from
the append-only event log. Replay follows related worker run, tool call,
policy decision, approval, evidence, and task ids automatically.

CI repair task output keeps separate runtime counters for orchestration
attempts, wrapped-worker attempts, publish attempts, interrupted-run
resumes, and approval rounds. These counters are separate from the
task-level `attempt` field so crash resume, worker retry, and approval
retry can be reported independently.

The product rule is strict: every side effect must be allowed, denied, or
attached to an approval request before it runs.

## Default Profiles

`runstead init` writes the safe default policy profile, which requires
approval before starting an external wrapped worker. `runstead init
--profile trusted-local` is for trusted local workstations: it allows the
built-in `codex_cli` and `claude_code` wrapped workers for that repo, but
still requires approval for dependency changes and publishing, and still
denies protected paths.

Trusted-local profiles may also allow the built-in `codex_direct` native
worker and trusted model provider resources such as `chatgpt_codex`,
`openai`, `openrouter`, `anthropic`, `gemini`, local OpenAI-compatible
endpoints, and other bundled provider ids. The selected provider id is
recorded in the policy decision for each model request. Protected paths,
dependency changes, publishing, and other external writes keep their
stricter rules.

Run `runstead upgrade` in older trusted-local workspaces to merge newly
supported provider resource ids into the policy allowlist.

## Approval Grants

Approval grants have two reuse modes:

- `single_use`: the default, applied to one action only
- `scoped_until_expiry`: the action declares a narrow reusable scope (for
  example a `codex_direct` scaffold patch bound to one task id and scaffold
  profile); subsequent equivalent actions reuse the grant until it expires
  or until the task ends

When the model regenerates an equivalent governed action after approval,
Runstead may consume an approved grant by:

1. exact `actionId`, or
2. `canonicalSignature` (`actionType + cwd + filesTouched + normalized risk
class + diff hash`), or
3. scoped reusable grant (only for action contracts that declare a narrow
   scope)

Tool-call output records which match type was used so audit export can
explain why the resumed action did not ask for a second approval.

## Risk Classes And Scaffold Patches

Policy rules can match action metadata such as `risk_class`. `codex_direct`
uses this for scaffold-aware MVP runs: a `filesystem.patch` is marked
`scaffold_app_patch` only when every touched file is inside the task's
declared scaffold paths and none are protected, dependency, or Runstead
state paths. Trusted-local policy can allow that narrow class while
dependency files, secrets, and `.runstead/**` remain approval-gated or
denied.

## Wrapped Versus Native Workers

Wrapped external workers run in `policy_gated_wrapper` mode. Runstead
provides Level 1 wrapped execution for external coding agents: it gates the
worker launch, records the action envelope and policy decision, starts the
worker with native sandbox or permission guardrails, checkpoints the
workspace, commits worker changes through a governed `git.commit` action,
verifies diff scope and command evidence after the worker exits, and audits
the result.

Full Level 2 tool-proxied execution, where every internal worker tool call
passes through Runstead, requires the native worker path. The wrapped
worker governance manifest records this as `internalToolProxy.mode: none`;
callers that require `hard_proxy` enforcement fail before the external
worker process is launched.

Native workers (`codex_direct`) use the `worker.native.start` action
contract. Model calls use `model.inference.request`, which records
`network_write_external` and `llm_data_egress` side effects.

## Extension Collector Policy

`runstead startup ready` enforces extension collector policy before allowing
their evidence into the readiness verdict (see [sdk.md](sdk.md)):

- collectors without `safeForWrappedWorkers: true` are rejected on Level 1
  wrapped workers
- collector `qualityTier` must meet the requested target's minimum (`local`
  accepts `self_reported`+, staging and production raise the bar)
- staging and production collectors must declare `defaultFreshnessDays`

These rules are policy, not advisory: failing them blocks the verdict.

## Unmanaged Helpers

Some ad-hoc CLI helpers are still labeled unmanaged. They are useful for
local diagnosis, but the product path is the governed runtime, agent, or CI
repair orchestrator.

Mutating unmanaged helpers require explicit acknowledgement with
`--unmanaged`:

- `runstead checkpoint restore`
- `runstead github pr create`
- `runstead git branch create`

The flag is a local escape hatch, not a policy decision or approval grant.
