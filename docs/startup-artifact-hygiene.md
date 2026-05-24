# Startup Artifact Hygiene

Runstead keeps durable local state under `.runstead`: evidence, reports,
startup run JSON, logs, and checkpoints. That is useful for audit and replay,
but dogfood runs can grow noisy.

Generate the latest view and retention report:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30
```

Outputs:

- `.runstead/startup/latest-artifacts.json`
- `.runstead/reports/startup-artifact-hygiene.md`
- `.runstead/reports/startup-artifact-hygiene.json`

The report classifies files as:

- `current`: latest readiness run artifacts or latest evidence per type
- `referenced`: still referenced by runs or evidence, but not the latest
- `superseded`: older evidence artifacts replaced by newer evidence of the same type
- `unreferenced`: not referenced by current Runstead state

By default the command does not delete files. To prune only old unreferenced
files:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30 --prune
```

Use this after a successful `startup ready` run when you want a compact dogfood
workspace while preserving current and referenced audit evidence.
