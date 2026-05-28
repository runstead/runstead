# Growth Readiness Extension Package

This directory is a package-shaped Runstead extension example. Copy the whole
directory into `.runstead/extensions/`:

```bash
mkdir -p .runstead/extensions
cp -R docs/examples/extensions/growth-readiness-package .runstead/extensions/
runstead startup ready --cwd . --stage launch --target local --plan
```

Runstead discovers `runstead-extension.yaml` inside the directory, compiles it
with `@runstead/sdk`, and runs the collector when the target requires it.

The manifest routes execution through the repository-owned `npm test` command:

```json
{
  "scripts": {
    "test": "node .runstead/extensions/growth-readiness-package/collector.mjs"
  }
}
```

That keeps the policy boundary explicit: the extension declares readiness
semantics, while the repository chooses which local command is allowed to run.
