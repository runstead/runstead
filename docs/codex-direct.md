# Codex Direct Worker

`codex_direct` is the Runstead-native Codex worker. It is separate from the
`codex_cli` wrapped worker:

- `codex_cli` starts an external `codex exec` process. Runstead gates the
  launch, checkpoints the workspace, verifies the diff, and records evidence,
  but cannot hard-proxy tool calls made inside the external process.
- `codex_direct` runs the Codex agent loop inside Runstead. Every exposed
  tool call becomes a governed Runstead action before it executes.

The boundary is intentional. `codex_direct` is not added to the
wrapped-worker module; the wrapped-worker module is for external process
hosting.

## Practical Status

`codex_direct` is the strict-governance worker. Use it through
`runstead startup ready --worker codex_direct --governance governed` for the
founder readiness path, or through `runstead agent run --worker codex_direct`
for repair-style tasks. `codex_cli` remains the fast Level 1 wrapped path.

Current practical guidance:

- use narrow edit or repair prompts; broad "build the whole product" prompts
  exhaust the turn budget
- give repair tasks enough `--max-turns` and `--max-tool-calls`
- deny `.git/**` and `.runstead/**` for model-controlled edits
- keep `.env`, secrets, production infra, dependency changes, pushes, and
  PRs approval-gated
- declare scaffold profiles when scaffolding a new app so safe app-owned
  writes share one approval grant
- require verifiers on every edit or repair task

If policy requires approval, approve the request and resume the same task —
or use `runstead approval approve-and-resume <id>` to do both in one
command. Approved patches are applied directly on resume without asking the
model to regenerate.

`startup ready --worker codex_direct` can also finish without calling the
model when the repo is already a verifiable MVP. In that green path,
Runstead keeps the governed worker boundary in the run record, initializes
state if needed, discovers verifier commands, runs UI smoke, writes launch
and complete-check reports, and returns the target-aware verdict. Empty-repo
scaffolds or actual repairs still require a configured provider because the
direct worker must enter the model/tool loop.

## Architecture

```text
agent run / repair-ci / run --once / daemon / startup ready
  -> worker routing
    -> codex_cli (Level 1 wrapped)
    -> codex_direct (Level 2 native proxy)
         -> ModelProviderRuntime
              -> CodexAuthStore + CodexResponsesTransport
              -> OpenAI-compatible Chat Completions transport
              -> Anthropic Messages transport
              -> Gemini generateContent transport
         -> @runstead/runtime tool-call adapters
              -> codexResponsesToolCallAdapter
              -> openAiChatCompletionsToolCallAdapter
         -> RunsteadToolLoop (governed by @runstead/governance,
              actions from @runstead/tools)
              -> filesystem.read/list/search/stat
              -> filesystem.write/patch
              -> shell.exec
              -> verifier.run
              -> repo.metadata.read
              -> evidence.read
              -> workspace.facts.read
              -> git.status/diff/log/show/diff.summary
              -> policy / approval / audit / evidence
```

`ModelProviderRuntime` resolves the selected provider from CLI flags,
`.runstead/config.yaml`, environment, model-name inference, then the default
Codex provider. Repository config may store provider and model choices, but
must not store access or refresh tokens.

`CodexAuthStore` owns Runstead's Codex credentials under
`$RUNSTEAD_HOME/auth.json` or `~/.runstead/auth.json`. Importing Codex CLI
credentials, if supported, must be explicit and one-shot because Codex
refresh tokens can conflict across clients.

Non-Codex provider transports adapt OpenAI-compatible Chat Completions,
Anthropic Messages, and Gemini generateContent responses into the same
internal Codex Responses-style turn format. That keeps the governed Runstead
tool loop identical regardless of provider.

## Module Layout

`packages/cli/src/codex-direct/`:

- `worker.ts`: top-level worker loop, model turn budgeting, resume, final
  result construction
- `tool-router.ts`: governed tool dispatch
- `tool-definitions.ts`: JSON schema for each exposed tool
- `tool-arguments.ts`: argument parsing and validation
- `tool-types.ts`: shared discriminators
- `governed-tools.ts`: shared `runGovernedToolAction` invocation paths
- `model-request.ts`: heartbeat, timeout abort, bounded retry with jitter
  for transient model errors, exhausted-retry classification
- `patch-actions.ts`: scaffold-aware `apply_patch` classification and
  approval grant resume
- `git-actions.ts`, `evidence-actions.ts`, `policy-actions.ts`: per-domain
  governed actions
- `result.ts`: `implementation × verification × agentCompletion` mapping
  through `@runstead/runtime` execution semantics
- `constants.ts`, `prompts.ts`: budget defaults and shared prompts

`codex-direct-worker.ts` at the package root is a stable re-export of
`./codex-direct/worker.js`.

## Action Contracts

Native worker startup uses `worker.native.start` with resource id
`codex_direct`. Model calls use `model.inference.request` with the selected
provider resource id (`chatgpt_codex`, `openrouter`, `anthropic`, `gemini`,
local OpenAI-compatible endpoints, or other bundled provider ids) and side
effects `network_write_external` and `llm_data_egress`.

The default repo-maintenance policy requires approval for both contracts.
`trusted-local` profiles can allow `codex_direct` and the bundled trusted
provider resource ids, while protected paths, dependency changes,
publishing, and other external writes remain governed by their existing
stricter rules. Existing workspaces should run `runstead upgrade` after
provider allowlists change.

For startup scaffold tasks, `filesystem.patch` carries task-scoped metadata.
The task input declares app-owned paths such as `index.html`, `styles.css`,
`app.js`, `server.js`, and `scripts/*.js`. A patch is classified as
`scaffold_app_patch` only when every touched file matches those paths and
none are protected, dependency, or Runstead state paths. Trusted-local
policy can allow that narrow class, and the approval grant is **scoped
until expiry** so it covers many writes in the same scaffold pass. Unrelated
workspace patches fall back to normal approval behavior.

## Tool Loop

Exposed tools (small, stable, governed):

- `list_files` → `filesystem.list`
- `search_text` → `filesystem.search`
- `read_file` → `filesystem.read`
- `read_many_files` → `filesystem.read`
- `file_info` → `filesystem.stat`
- `tree` → `filesystem.list`
- `package_scripts` → `repo.metadata.read`
- `apply_patch` → `filesystem.patch`
- `run_verifier` → `verifier.run`
- `write_file` → `filesystem.write`
- `run_command` → `shell.exec`
- `git_status` → `git.status`
- `git_diff` → `git.diff`
- `git_log` → `git.log`
- `git_show` → `git.show`
- `diff_summary` → `git.diff.summary`
- `read_evidence` → `evidence.read`
- `workspace_facts` → `workspace.facts.read`

If policy requires approval, the worker stops with an approval-required
result. It does not ask the model to work around the denied or pending
action. Push, publish, and pull request creation stay with the orchestrator
rather than being exposed to the model.

## Model Request Resilience

Each model request goes through `runModelRequestWithHeartbeat`:

- a heartbeat record is written to SQLite at request start and again while
  waiting, so long-running calls are observable
- the request has a phase-aware timeout (`final_summary` can differ from a
  normal turn)
- transient provider errors are retried with jittered exponential backoff
  up to `--max-retries`
- on terminal failure with prior retries, `CodexDirectModelRetryExhaustedError`
  is thrown so the audit trail records the retry budget that was spent

## Local Agent Workflow

List the providers Runstead can route through the `codex_direct` local agent:

```bash
runstead agent providers
```

For the Codex backend, authenticate once into Runstead's Codex Direct auth
store:

```bash
runstead codex login
runstead codex models --refresh
```

For other providers, configure provider, model, and credentials instead of
using `runstead codex login`:

```bash
runstead config set --cwd /path/to/target-repo model.provider openrouter
runstead config set --cwd /path/to/target-repo model.name anthropic/claude-opus-4.6
export OPENROUTER_API_KEY=...
```

You can also pass per-run overrides:

```bash
runstead agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --provider anthropic \
  --model claude-opus-4.6 \
  "Inspect this repo and summarize the main test commands."
```

Initialize the target repository with a local policy profile:

```bash
runstead init --cwd /path/to/target-repo --profile trusted-local
```

Run a read-only inspection task:

```bash
runstead agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  "Inspect this repo and summarize the main test commands."
```

Run an edit task with verifier evidence:

```bash
runstead agent run \
  --cwd /path/to/target-repo \
  --worker codex_direct \
  --mode edit \
  --allowed "src/**" \
  --verifier "test=pnpm test" \
  "Make the requested small code change."
```

Edit and repair modes create a workspace checkpoint before model-controlled
writes, then run configured verifiers after the worker completes. If policy
requires approval, approve the pending request and resume the same task:

```bash
runstead approval list --cwd /path/to/target-repo
runstead approval show <approval-id> --cwd /path/to/target-repo
runstead approval approve-and-resume <approval-id> --cwd /path/to/target-repo
```

Audit summaries are available without re-running the task:

```bash
runstead agent report <task-id> --cwd /path/to/target-repo
```

Reports include both `Provider` and `Model` so it is clear whether a run
used Codex, OpenRouter, Anthropic, Gemini, a local OpenAI-compatible
endpoint, or another configured provider.

Runstead routes queued `local_agent_task` records through `run --once`, so
daemon ticks can consume locally scheduled agent work. Runtime artifacts
under `.runstead/state.db`, `evidence/`, `logs/`, `checkpoints/`, `daemon/`,
and `reports/` are ignored by `.runstead/.gitignore` and local Git
`info/exclude` when possible.

If a previous run crashed and left tasks in `running`, recover them:

```bash
runstead resume --cwd /path/to/target-repo
```

## CI Repair Integration

`repair-ci --worker codex_direct --provider <provider> --model <model>`
reuses the existing CI repair stages: branch creation, checkpointing,
diff-scope verification, verifiers, commit, and PR publication. The only
changed stage is worker execution: `codex_direct` produces governed
tool-call audit records while `codex_cli` remains the Level 1 external
wrapper.

For queued `ci_repair` tasks, `runstead run --once --model <model>` prefers
`codex_direct` when local Codex credentials are present and not expired.
Without local Codex credentials or a model, the runner falls back to
`codex_cli`.

When a non-Codex provider is configured in `.runstead/config.yaml` or
`RUNSTEAD_MODEL_PROVIDER`, `codex_direct` uses that provider instead of the
Codex auth store.

## Optional Live Smoke

Unit tests use fake transports by default. To run a real local smoke against
the configured Codex backend, opt in explicitly:

```bash
RUNSTEAD_LIVE_CODEX_DIRECT=1 \
RUNSTEAD_LIVE_CODEX_MODEL=<codex-model> \
pnpm --filter @runstead/cli test -- local-agent-live
```

The smoke creates a temporary target repo, runs a read-only local agent
task, and leaves normal test runs offline.

## Post-MVP Considerations

Credential pooling is intentionally deferred. Runstead keeps a single
Runstead-owned Codex OAuth session in the local auth store and does not
automatically reuse Codex CLI credentials, because refresh tokens can
conflict across clients. A future pool should be explicit about account
ownership, refresh locking, and per-worker assignment.

Codex model discovery uses the live Codex models endpoint, writes a
token-free local cache, and can fall back to configured model ids.
Non-Codex providers use explicit model ids from config, environment, or CLI
flags.

Streaming is also deferred. The MVP transport uses request/response calls
so each model request has one `model.inference.request` policy decision and
one auditable outcome. Streaming should only be added when streamed chunks
can be summarized without persisting raw model output.

Quota and failover stay outside the first CI repair integration. The
initial worker fails clearly on provider errors; later failover can be
layered on top of recorded model-call outcomes and explicit operator
policy.
