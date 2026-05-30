# Product Positioning

Runstead is the control plane for governed AI-native execution, starting
with repo maintenance and launch-ready software delivery.

The founder-facing version is:

> Runstead helps AI-native founders turn goals into governed, evidence-backed
> work across product, code, and operations.

The product should not be positioned as a founder coach, a project
management tool, a Claude or Codex wrapper, or a generic agent framework.
Its durable value is the execution layer that makes AI work bounded,
evidenced, verifiable, auditable, and resumable.

## Wedge

The first commercial wedge is AI-coded MVP readiness:

> Runstead for AI-coded MVPs: keep agent-built products verifiable,
> auditable, and launch-ready.

This keeps the scope narrow enough to ship and valuable enough to pay for.
MVP and launch teams already have real repositories, tests, CI, releases,
incidents, support workflows, technical debt, and deployment risk. Runstead
reuses the repo-maintenance control loop here instead of becoming a
chat-first idea validation product.

## Product Boundaries

Runstead owns:

- durable goals and task records
- scoped autonomy policies and reusable approval grants
- verifier discovery and execution evidence
- checkpoints, execution leases, audit logs, and resume paths
- readiness reports, stage gates, and a unified release-decision engine
- third-party extension contracts via `@runstead/sdk`
- a local dashboard with a protected, opt-in operator console
- an experimental team-control-plane contract that `@runstead/state-postgres`
  satisfies after the local/CI path is already working

Worker agents own:

- code edits
- investigation
- implementation planning
- local repair attempts
- summarization from gathered evidence

Runstead keeps the final state in structured artifacts, repository files,
SQLite or Postgres state, evidence records, reports, and decision records.
Chat can be an interaction surface, but it should not be the source of
truth.

## Product Principles

1. Evidence before execution

   No evidence, no encouraged build. No verifier, no encouraged merge. No
   measurement framework, no encouraged launch.

2. Agents are workers, Runstead is the control plane

   Claude, Codex, and other workers execute. Runstead governs goals,
   boundaries, evidence, acceptance, audit, recovery, and team handoff.

3. Artifacts beat chat

   The durable product output is a file, state record, evidence artifact,
   report, or decision record.

4. Autonomy must be scoped

   AI workers can act with useful autonomy only inside explicit path,
   tool, policy, budget, verifier, and approval limits. Approval grants
   may be reused under canonical signature or scoped reusable rules; they
   must not be bypassed.

5. Stage gates matter

   Idea, MVP, Launch, Scale, and Complete each need exit criteria backed
   by evidence. Local launch evidence does not substitute for production
   evidence.

6. Failure modes deserve as much design as success modes

   Crashed runs, stale tasks, transient model errors, failed UI smoke,
   exhausted retry budgets, and revoked approvals all have explicit
   recovery paths in the product.

## What Runstead Is Not

Runstead should not become:

- an AI startup mentor
- a Claude or Codex wrapper
- a project management clone
- a Zapier-style automation surface
- another agent framework
- a multi-tenant SaaS without an explicit operator deployment

It should keep returning to governed, evidence-backed execution: goals,
policies, verifiers, evidence, checkpoints, audits, stage gates, reports,
and resume paths.

## Roadmap Shape

The current near-term focus:

- close residual gaps in the founder readiness loop (recover paths,
  resilience, scaffolded approval reuse)
- mature the extension ecosystem (more example collectors, adapter
  contracts, freshness enforcement)
- harden the experimental team-control-plane path after the local/CI readiness
  loop remains clear (Postgres conformance, runner identity, shared artifact
  store)
- keep the documentation honest about what a chosen worker mode can and
  cannot prove
