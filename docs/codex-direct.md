# Codex Direct Worker

`codex_direct` is the Runstead-native Codex worker. It is separate from
the existing `codex_cli` wrapped worker:

- `codex_cli` starts an external `codex exec` process. Runstead gates launch,
  checkpoints the workspace, verifies the diff, and records the resulting
  evidence, but it cannot hard-proxy tool calls made inside the external
  process.
- `codex_direct` runs the Codex agent loop inside Runstead. Every exposed tool
  call must become a governed Runstead action before it executes.

The boundary is intentional. `codex_direct` should not be added to
`wrapped-worker.ts`; that module is for external process wrappers.

## Architecture

```text
agent run / repair-ci / run --once / daemon
  -> worker routing
    -> codex_cli
    -> codex_direct
         -> CodexAuthStore
         -> CodexResponsesTransport
         -> RunsteadToolLoop
              -> filesystem.read
              -> filesystem.list
              -> filesystem.search
              -> filesystem.write
              -> shell.exec
              -> git.status
              -> git.diff
              -> policy / approval / audit / evidence
```

`CodexAuthStore` owns Runstead's provider credentials under
`$RUNSTEAD_HOME/auth.json` or `~/.runstead/auth.json`. Repository
`.runstead/config.yaml` may store provider and model choices, but it must not
store access or refresh tokens. Importing Codex CLI credentials, if supported,
must be explicit and one-shot because Codex refresh tokens can conflict across
clients.

`CodexResponsesTransport` implements the minimal Codex Responses API surface
needed by the worker. It should use injectable `fetch` for tests. The default
Codex endpoint is experimental and must be configurable because
`https://chatgpt.com/backend-api/codex` is not a stable public API.

## Action Contracts

Native worker startup uses `worker.native.start` with resource id
`codex_direct`. Model calls use `model.inference.request` with resource id
`chatgpt_codex` and side effects:

- `network_write_external`
- `llm_data_egress`

The default repo-maintenance policy requires approval for both contracts.
`trusted-local` can allow `codex_direct` and `chatgpt_codex`, while protected
paths, dependency changes, publishing, and other external writes remain
governed by their existing stricter rules.

## Tool Loop

The first tool set should stay small:

- `list_files` -> `filesystem.list`
- `search_text` -> `filesystem.search`
- `read_file` -> `filesystem.read`
- `read_many_files` -> `filesystem.read`
- `write_file` -> `filesystem.write`
- `run_command` -> `shell.exec`
- `git_status` -> `git.status`
- `git_diff` -> `git.diff`

If policy requires approval, the worker must stop with an approval-required
result. It must not ask the model to work around the denied or pending action.
Push, publish, and pull request creation stay with the orchestrator rather than
being exposed to the model.

## Local Agent Workflow

Authenticate once into Runstead's Codex Direct auth store:

```bash
pnpm exec tsx packages/cli/src/index.ts codex login
pnpm exec tsx packages/cli/src/index.ts codex models --refresh
```

Initialize the target repository with a local policy profile:

```bash
pnpm exec tsx packages/cli/src/index.ts init \
  --cwd /path/to/target-repo \
  --profile trusted-local
```

Run a read-only inspection task:

```bash
pnpm exec tsx packages/cli/src/index.ts agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --model <codex-model> \
  "Inspect this repo and summarize the main test commands."
```

Run an edit task with verifier evidence:

```bash
pnpm exec tsx packages/cli/src/index.ts agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --model <codex-model> \
  --mode edit \
  --allowed "src/**" \
  --verifier "test=pnpm test" \
  "Make the requested small code change."
```

Edit and repair modes create a workspace checkpoint before model-controlled
writes, then run configured verifiers after the Codex Direct worker completes.
If policy requires approval, approve the pending request and resume the same
task:

```bash
pnpm exec tsx packages/cli/src/index.ts approval list --cwd /path/to/target-repo
pnpm exec tsx packages/cli/src/index.ts approval approve <approval-id> --cwd /path/to/target-repo
pnpm exec tsx packages/cli/src/index.ts agent resume <task-id> --cwd /path/to/target-repo
```

Audit summaries are available without re-running the task:

```bash
pnpm exec tsx packages/cli/src/index.ts agent report <task-id> --cwd /path/to/target-repo
```

Runstead also routes queued `local_agent_task` records through `run --once`,
so daemon ticks can consume locally scheduled agent work. Runtime artifacts
under `.runstead/state.db`, `evidence/`, `logs/`, `checkpoints/`, `daemon/`,
and `reports/` are ignored by `.runstead/.gitignore` and local Git
`info/exclude` when possible.

## CI Repair Integration

`repair-ci --worker codex_direct --model <model>` reuses the existing CI
repair stages: branch creation, checkpointing, diff-scope verification,
verifiers, commit, and PR publication. The only changed stage is worker
execution: `codex_direct` produces governed tool-call audit records while
`codex_cli` remains the Level 1 external wrapper.

For queued `ci_repair` tasks, `runstead run --once --model <model>` prefers
`codex_direct` when local Codex credentials are present and not expired. Without
local Codex credentials or a model, the runner falls back to `codex_cli`.

## Optional Live Smoke

Unit tests use fake transports by default. To run a real local smoke against the
configured Codex Direct backend, opt in explicitly:

```bash
RUNSTEAD_LIVE_CODEX_DIRECT=1 \
RUNSTEAD_LIVE_CODEX_MODEL=<codex-model> \
pnpm --filter @runstead/cli test -- local-agent-live
```

The smoke creates a temporary target repo, runs a read-only local agent task,
and leaves normal test runs offline.

## Post-MVP Considerations

Credential pooling is intentionally deferred. Runstead keeps a single
Runstead-owned Codex OAuth session in the local auth store and does not
automatically reuse Codex CLI credentials, because refresh tokens can conflict
across clients. A future pool should be explicit about account ownership,
refresh locking, and per-worker assignment.

Model discovery uses the live Codex models endpoint, writes a token-free local
cache, and can fall back to configured model ids. That is enough for the first
direct worker path without adding a larger provider catalog.

Streaming is also deferred. The MVP transport uses request/response calls so
each model request has one `model.inference.request` policy decision and one
auditable outcome. Streaming should only be added when streamed chunks can be
summarized without persisting raw model output.

Quota and failover should stay outside the first CI repair integration. The
initial worker should fail clearly on provider errors; later failover can be
layered on top of recorded model-call outcomes and explicit operator policy.
