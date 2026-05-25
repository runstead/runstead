# Startup Artifact Hygiene

Runstead keeps durable local state under `.runstead`: evidence, reports,
startup run JSON, logs, and checkpoints. That is useful for audit and replay,
but dogfood runs can grow noisy over time.

Generate the latest view and retention report:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30
```

Outputs:

- `.runstead/startup/latest-artifacts.json`
- `.runstead/reports/startup-artifact-hygiene.md`
- `.runstead/reports/startup-artifact-hygiene.json`

The report classifies files in five directories (`evidence`, `reports`,
`startup`, `logs`, `checkpoints`) into four layers:

- `current`: latest readiness run artifacts and latest evidence per type
- `referenced`: still referenced by runs, reports, or evidence rows, but not
  the latest of its kind
- `superseded`: older evidence artifacts replaced by newer evidence of the
  same type
- `unreferenced`: not referenced by any current Runstead state

Each file row includes its size, modification timestamp, age in days, layer,
which records reference it, and whether it is a prune candidate.

By default the command does not delete files. To prune only old unreferenced
files:

```bash
runstead startup artifact hygiene --cwd /path/to/mvp --retention-days 30 --prune
```

`--prune` only removes files in the `unreferenced` layer that are older than
the retention window. Current, referenced, and superseded artifacts are
preserved so audit replay and stale-evidence appendices keep working.

Use this after a successful `startup ready` run when you want a compact
dogfood workspace while preserving current and referenced audit evidence.

## When To Run It

- after each major dogfood cycle, before checking in or sharing the workspace
- when `.runstead/evidence` or `.runstead/reports` grows past expectations
- before producing a release report to make sure the launch readiness report
  cites only current evidence and that stale evidence is collected in the
  appendix rather than scattered through the main body
