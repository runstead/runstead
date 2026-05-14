# Verifier

Runstead completion is verifier-first. A task is not complete because a worker
claims success; it is complete when verifier evidence says it passed.

The current verifier path supports:

- deterministic shell command verifiers
- policy decisions before verifier command execution
- command output evidence artifacts
- policy-block evidence for denied or approval-required commands
- diff scope verification for CI repair worker changes
- GitHub workflow run log evidence for CI repair intake
- PR evidence summaries generated from task and verifier output

Auxiliary model review can be added later, but it must not be the only required
verifier.

Evidence artifacts should be stored under `.runstead/evidence/` and referenced
from SQLite.
