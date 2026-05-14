# Skills

Skill packages remain experimental and are not part of the default autonomous
runtime. A candidate can be created, validated, tested, and then manually
promoted only after its package tests pass:

```sh
runstead skill candidate create fix-pnpm-ci-failures \
  --description "Diagnose pnpm CI failures" \
  --trigger ci_failure \
  --allowed-tool filesystem.read \
  --denied-tool secret.read \
  --verifier-command "pnpm test" \
  --task task_001

runstead skill test ./skills/fix-pnpm-ci-failures
runstead skill promote ./skills/fix-pnpm-ci-failures --promoted-by maintainer
runstead skill deprecate ./skills/fix-pnpm-ci-failures \
  --deprecated-by maintainer \
  --reason "superseded by a safer workflow"
```

Promotion updates `skill.yaml` from `candidate` to `promoted` and appends the
promotion decision to `changelog.md`. It does not automatically attach the skill
to future tasks. Deprecation updates `skill.yaml` from `promoted` to
`deprecated` and records the reason in `changelog.md`.

Skill package validation fails closed when required package files are symlinks or
resolve outside the package root. Keep `skill.yaml`, `SKILL.md`,
`permissions.yaml`, `tests/run.sh`, and `rollback.md` as regular files inside
the package so promotion cannot smuggle instructions, tests, or rollback notes
from another location.
