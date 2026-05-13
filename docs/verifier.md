# Verifier

Runstead completion is verifier-first. A task is not complete because a worker
claims success; it is complete when verifier evidence says it passed.

M0 starts with deterministic shell command verifiers. M1/M2 can add:

- diff scope verifier
- GitHub CI status verifier
- PR evidence verifier
- auxiliary model review, never as the only required verifier

Evidence artifacts should be stored under `.runstead/evidence/` and referenced
from SQLite.
