# Policy

Policy decisions must be based on structured action envelopes, not natural
language. The M0 scaffold only stores the first policy template. M1 should add:

- action envelope schema
- policy DSL parser
- deterministic evaluator
- risk scorer
- approval request model
- shell/filesystem/git tool guards

The product rule is strict: every side effect must be allowed, denied, or
attached to an approval request before it runs.
