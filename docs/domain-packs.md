# Domain Packs

Domain packs define what a class of long-running work means. They are templates
and contracts, not runtime state.

The first built-in domain pack is `repo-maintenance`. It starts with:

- `keep-ci-green` goal template
- `repo_inspect` and `run_local_verifiers` task types
- shell worker routing
- command and diff-scope verifier defaults
- protected-path security defaults

Runtime task and goal state belongs in SQLite under `.runstead/state.db`.
Domain YAML remains configuration and template material only.
