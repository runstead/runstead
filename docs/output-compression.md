# Output Compression

`@runstead/runtime` exposes a shared output-compression rules layer for
connector payloads, worker output, model output, evidence excerpts, and verifier
output.

The layer standardizes three behaviors that were previously easy to reimplement
inside each adapter:

- bound raw text before it is persisted or passed into a model context
- redact explicit secrets plus token-like fields and bearer tokens
- keep head and tail context when truncating long output

Default use cases:

| Use case            | Default limit |
| ------------------- | ------------- |
| `connector_payload` | 4,000 chars   |
| `worker_output`     | 8,000 chars   |
| `model_output`      | 6,000 chars   |
| `evidence_excerpt`  | 3,000 chars   |
| `verifier_output`   | 12,000 chars  |

Connector source parsing already uses this shared layer for invalid provider
response excerpts and JSON redaction. Other workers and adapters can use
`compressRuntimeOutput`, `redactRuntimeOutputJson`, and
`redactRuntimeOutputText` without importing CLI internals.
