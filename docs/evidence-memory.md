# Evidence Memory

Runstead now has a package-level Evidence Memory Tree model in
`@runstead/evidence`. It is a pure projection layer: evidence rows from local
SQLite, Postgres, connector sync, startup source collection, or manual operator
input can all be normalized into the same tree.

The tree path is:

```text
domain -> connector -> evidence type -> profile/resource -> evidence item
```

This makes evidence usable as a wiki-like memory surface:

- domain nodes show which business area the evidence belongs to
- connector nodes show where the evidence came from, including manual fallback
- evidence-type nodes match domain contracts and evaluators
- profile nodes group evidence by repository, topic, customer, product,
  workspace, or other durable subject
- evidence leaf nodes keep the concrete id, URI, summary, and audit pointer

The model is intentionally independent of collection. It does not fetch or
trust evidence by itself; it gives adapters, Work Packs, dashboards, and future
retrieval flows one stable shape for organizing evidence after it has been
recorded.
