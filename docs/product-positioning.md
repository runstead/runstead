# Product Positioning

Runstead is the control plane for governed AI-native execution, starting with
repo maintenance and launch-ready software delivery.

The founder-facing version is:

> Runstead helps AI-native founders turn goals into governed, evidence-backed
> work across product, code, and operations.

The product should not be positioned as a founder coach, a project management
tool, a Claude or Codex wrapper, or a generic agent framework. Its durable value
is the execution layer that makes AI work bounded, evidenced, verifiable,
auditable, and resumable.

## Wedge

The first commercial wedge is AI-coded MVP readiness:

> Runstead for AI-coded MVPs: keep agent-built products verifiable, auditable,
> and launch-ready.

This keeps the scope narrow enough to ship and valuable enough to pay for. MVP
and launch teams already have real repositories, tests, CI, releases, incidents,
support workflows, technical debt, and deployment risk. Runstead can reuse the
repo-maintenance control loop here instead of becoming a chat-first idea
validation product.

## Product Boundaries

Runstead owns:

- durable goals and task records
- scoped autonomy policies
- verifier discovery and execution evidence
- checkpoints, audit logs, and resume paths
- readiness reports and stage gates
- decision and evidence artifacts

Worker agents own:

- code edits
- investigation
- implementation planning
- local repair attempts
- summarization from gathered evidence

Runstead should keep the final state in structured artifacts, repository files,
SQLite state, evidence records, reports, and decision records. Chat can be the
interaction surface, but it should not be the source of truth.

## Product Principles

1. Evidence before execution

   No evidence, no encouraged build. No verifier, no encouraged merge. No
   measurement framework, no encouraged launch.

2. Agents are workers, Runstead is the control plane

   Claude, Codex, and other workers execute. Runstead governs goals, boundaries,
   evidence, acceptance, audit, and recovery.

3. Artifacts beat chat

   The durable product output is a file, state record, evidence artifact,
   report, or decision record.

4. Autonomy must be scoped

   AI workers can act with useful autonomy only inside explicit path, tool,
   policy, budget, verifier, and approval limits.

5. Stage gates matter

   Idea, MVP, Launch, and Scale each need exit criteria backed by evidence.

## 90 Day Target

Within 90 days, Runstead should become the default readiness and control plane
for AI-coded MVPs before launch.

Acceptance criteria:

- a founder can initialize an existing MVP repository with a startup domain pack
- Runstead can generate agent context and a measurement framework task trail
- Runstead can use Codex or Claude Code for repo audit work
- Runstead can produce a launch readiness report
- each risk item has evidence, a source, and a recommended next task
- remediation work can close the loop through Runstead agent and verifier runs
- the final report answers whether the AI-coded MVP can launch, and what blocks
  it if it cannot
