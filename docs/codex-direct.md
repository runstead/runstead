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

## Practical Status

`codex_direct` is the strict-governance worker, not the recommended default
founder workflow. Use `codex_cli` for ordinary MVP builds and use
`codex_direct` when the audit requirement is stronger than the UX cost.

Current practical guidance:

- use narrow edit or repair prompts
- give repair tasks enough `--max-turns` and `--max-tool-calls`
- deny `.git/**` and `.runstead/**` for model-controlled edits
- keep `.env`, secrets, production infra, dependency changes, pushes, and PRs
  approval-gated
- configure trusted local source-file writes deliberately when an edit-heavy
  task should not stop on every normal workspace file write
- require verifier evidence for every edit or repair task

If policy requires approval, approve the request and resume the same task.
Broad "build the whole product" prompts can exhaust the direct worker's turn
budget; a narrower repair task usually produces a cleaner evidence trail.

## Architecture

```text
agent run / repair-ci / run --once / daemon
  -> worker routing
    -> codex_cli
    -> codex_direct
         -> ModelProviderRuntime
              -> CodexAuthStore + CodexResponsesTransport
              -> OpenAI-compatible Chat Completions transport
              -> Anthropic Messages transport
              -> Gemini generateContent transport
         -> RunsteadToolLoop
              -> filesystem.read
              -> filesystem.list
              -> filesystem.search
              -> filesystem.stat
              -> filesystem.write
              -> shell.exec
              -> verifier.run
              -> repo.metadata.read
              -> evidence.read
              -> workspace.facts.read
              -> git.status
              -> git.diff
              -> git.log
              -> git.show
              -> git.diff.summary
              -> policy / approval / audit / evidence
```

`ModelProviderRuntime` resolves the selected provider from CLI flags,
`.runstead/config.yaml`, environment, model-name inference, then the default
Codex provider. Repository config may store provider and model choices, but it
must not store access or refresh tokens.

`CodexAuthStore` owns Runstead's Codex credentials under
`$RUNSTEAD_HOME/auth.json` or `~/.runstead/auth.json`. Importing Codex CLI
credentials, if supported, must be explicit and one-shot because Codex refresh
tokens can conflict across clients.

The non-Codex provider transports adapt OpenAI-compatible Chat Completions,
Anthropic Messages, and Gemini generateContent responses into the same internal
Codex Responses-style turn format. That keeps the governed Runstead tool loop
identical regardless of provider.

## Action Contracts

Native worker startup uses `worker.native.start` with resource id
`codex_direct`. Model calls use `model.inference.request` with the selected
provider resource id, such as `chatgpt_codex`, `openrouter`, `anthropic`, or
`gemini`, and side effects:

- `network_write_external`
- `llm_data_egress`

The default repo-maintenance policy requires approval for both contracts.
`trusted-local` can allow `codex_direct` and the bundled trusted provider
resource ids, while protected paths, dependency changes, publishing, and other
external writes remain governed by their existing stricter rules. Existing
workspaces should run `runstead upgrade` after provider allowlists change.

## Tool Loop

The first tool set should stay small:

- `list_files` -> `filesystem.list`
- `search_text` -> `filesystem.search`
- `read_file` -> `filesystem.read`
- `read_many_files` -> `filesystem.read`
- `file_info` -> `filesystem.stat`
- `tree` -> `filesystem.list`
- `package_scripts` -> `repo.metadata.read`
- `apply_patch` -> `filesystem.patch`
- `run_verifier` -> `verifier.run`
- `write_file` -> `filesystem.write`
- `run_command` -> `shell.exec`
- `git_status` -> `git.status`
- `git_diff` -> `git.diff`
- `git_log` -> `git.log`
- `git_show` -> `git.show`
- `diff_summary` -> `git.diff.summary`
- `read_evidence` -> `evidence.read`
- `workspace_facts` -> `workspace.facts.read`

If policy requires approval, the worker must stop with an approval-required
result. It must not ask the model to work around the denied or pending action.
Push, publish, and pull request creation stay with the orchestrator rather than
being exposed to the model.

## Local Agent Workflow

List the providers Runstead can route through the `codex_direct` local agent:

```bash
pnpm exec tsx packages/cli/src/index.ts agent providers
```

For the Codex backend, authenticate once into Runstead's Codex Direct auth
store:

```bash
pnpm exec tsx packages/cli/src/index.ts codex login
pnpm exec tsx packages/cli/src/index.ts codex models --refresh
```

For other providers, configure provider, model, and credentials instead of
using `runstead codex login`:

```bash
pnpm exec tsx packages/cli/src/index.ts config set \
  --cwd /path/to/target-repo \
  model.provider openrouter
pnpm exec tsx packages/cli/src/index.ts config set \
  --cwd /path/to/target-repo \
  model.name anthropic/claude-opus-4.6
export OPENROUTER_API_KEY=...
```

You can also pass per-run overrides:

```bash
pnpm exec tsx packages/cli/src/index.ts agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --provider anthropic \
  --model claude-opus-4.6 \
  "Inspect this repo and summarize the main test commands."
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
  --model <model> \
  "Inspect this repo and summarize the main test commands."
```

Run an edit task with verifier evidence:

```bash
pnpm exec tsx packages/cli/src/index.ts agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --model <model> \
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

Reports include both `Provider` and `Model` so it is clear whether a run used
Codex, OpenRouter, Anthropic, Gemini, a local OpenAI-compatible endpoint, or
another configured provider.

Runstead also routes queued `local_agent_task` records through `run --once`,
so daemon ticks can consume locally scheduled agent work. Runtime artifacts
under `.runstead/state.db`, `evidence/`, `logs/`, `checkpoints/`, `daemon/`,
and `reports/` are ignored by `.runstead/.gitignore` and local Git
`info/exclude` when possible.

## CI Repair Integration

`repair-ci --worker codex_direct --provider <provider> --model <model>` reuses
the existing CI
repair stages: branch creation, checkpointing, diff-scope verification,
verifiers, commit, and PR publication. The only changed stage is worker
execution: `codex_direct` produces governed tool-call audit records while
`codex_cli` remains the Level 1 external wrapper.

For queued `ci_repair` tasks, `runstead run --once --model <model>` prefers
`codex_direct` when local Codex credentials are present and not expired. Without
local Codex credentials or a model, the runner falls back to `codex_cli`.

When a non-Codex provider is configured in `.runstead/config.yaml` or
`RUNSTEAD_MODEL_PROVIDER`, `codex_direct` uses that provider instead of the
Codex auth store.

## Optional Live Smoke

Unit tests use fake transports by default. To run a real local smoke against the
configured Codex backend, opt in explicitly:

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

Codex model discovery uses the live Codex models endpoint, writes a token-free
local cache, and can fall back to configured model ids. Non-Codex providers use
explicit model ids from config, environment, or CLI flags.

Streaming is also deferred. The MVP transport uses request/response calls so
each model request has one `model.inference.request` policy decision and one
auditable outcome. Streaming should only be added when streamed chunks can be
summarized without persisting raw model output.

Quota and failover should stay outside the first CI repair integration. The
initial worker should fail clearly on provider errors; later failover can be
layered on top of recorded model-call outcomes and explicit operator policy.
