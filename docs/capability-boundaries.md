# Capability Boundaries

Runstead should grow by adding the right kind of capability at the right layer.
This keeps Work Packs business-domain shaped while still allowing provider
adapters, workspace collectors, and worker guidance to evolve independently.

The executable source of this catalog is
`packages/domain-packs/src/capability-boundary.ts`; this document explains the
operator-facing contract.

| Layer       | Owns                                                                                                                             | Use when                                                                                                        | Do not use for                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domain pack | Business workflow shape, task and goal templates, capability policy, evidence contracts, requirement evaluators, fixtures, evals | A workflow needs domain-specific proof semantics and reusable operator scenarios                                | Provider OAuth, HTTP details, workspace collectors, one-off worker recipes                    |
| Extension   | Workspace or package evidence collectors, readiness facets, verifiers, gates                                                     | A third-party or workspace integration proves readiness for an existing domain                                  | Changing the domain's business meaning, teaching the worker, owning global provider identity  |
| Skill       | Reusable worker guidance, bounded troubleshooting procedures, tool allow/deny hints, rollback notes, skill tests                 | The capability is instructions plus existing tools, and can be canaried as a future recipe                      | Authoritative evidence collection, new provider auth/transport, business completion semantics |
| Connector   | Canonical external or workspace source identity, credential names, read/write surface, evidence types, maturity                  | Multiple packs or extensions refer to the same external system, or operators need source readiness before a run | Domain task ordering, provider-specific business evaluation, worker prompt recipes            |
| Tool        | Precise runtime actions, side effects, provider HTTP calls, filesystem/shell operations, streaming or binary processing          | Execution must be deterministic, or needs custom auth, parsing, streaming, or binary handling                   | Business evidence requirements, workflow packaging, soft worker advice                        |

## Why This Matters

Hermes-like skill catalogs are useful because they keep lightweight procedures
out of the runtime. OpenHuman-like integrations are useful because they turn
external systems into persistent sources. Runstead needs both, but with a
governance boundary:

- **Domain packs** define what the business workflow means.
- **Connectors** define what external source a pack or extension is talking
  about.
- **Extensions** prove domain requirements using workspace or provider evidence.
- **Skills** guide workers inside bounded task families.
- **Tools** execute precise actions under policy and audit.

When a new capability is proposed, start by choosing this layer. If the proposal
needs more than one layer, split it. For example, a production support workflow
may need a `customer-support` domain pack, a `zendesk` connector, a Zendesk
evidence collector extension, and a skill that teaches the worker how to
summarize ticket patterns. Those should be separate artifacts.
