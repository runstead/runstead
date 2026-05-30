import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { validateDomainPackDir } from "./validator.js";

export interface CreateDomainPackTemplateOptions {
  id: string;
  outputDir?: string;
  name?: string;
  description?: string;
  force?: boolean;
}

export interface CreateDomainPackTemplateResult {
  root: string;
  files: string[];
}

const DOMAIN_PACK_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export async function createDomainPackTemplate(
  options: CreateDomainPackTemplateOptions
): Promise<CreateDomainPackTemplateResult> {
  const id = normalizeDomainPackId(options.id);
  const root = resolve(options.outputDir ?? id);
  const name = options.name ?? titleFromId(id);
  const description =
    options.description ?? `Custom ${name} domain pack for governed work.`;
  const files = [
    "AUTHORING.md",
    "domain.yaml",
    "goal-templates/default-goal.yaml",
    "task-types/manual_review.yaml",
    "policies/default.yaml",
    "fixtures/manifest.yaml",
    "fixtures/manual-review-smoke/README.md",
    "evals/benchmark.yaml"
  ];

  await mkdir(join(root, "goal-templates"), { recursive: true });
  await mkdir(join(root, "task-types"), { recursive: true });
  await mkdir(join(root, "policies"), { recursive: true });
  await mkdir(join(root, "fixtures", "manual-review-smoke"), { recursive: true });
  await mkdir(join(root, "evals"), { recursive: true });

  await writeIfMissing(
    join(root, "AUTHORING.md"),
    authoringGuide({ id, name }),
    options.force
  );
  await writeIfMissing(
    join(root, "domain.yaml"),
    domainYaml({ id, name, description }),
    options.force
  );
  await writeIfMissing(
    join(root, "goal-templates", "default-goal.yaml"),
    goalTemplateYaml({ id, name }),
    options.force
  );
  await writeIfMissing(
    join(root, "task-types", "manual_review.yaml"),
    taskTypeYaml({ id }),
    options.force
  );
  await writeIfMissing(
    join(root, "policies", "default.yaml"),
    policyYaml({ id }),
    options.force
  );
  await writeIfMissing(
    join(root, "fixtures", "manifest.yaml"),
    fixtureManifestYaml(),
    options.force
  );
  await writeIfMissing(
    join(root, "fixtures", "manual-review-smoke", "README.md"),
    fixtureReadme({ name }),
    options.force
  );
  await writeIfMissing(
    join(root, "evals", "benchmark.yaml"),
    evalBenchmarkYaml(),
    options.force
  );

  const validation = await validateDomainPackDir(root);

  if (!validation.valid) {
    throw new Error(
      `Generated domain pack is invalid: ${validation.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return {
    root,
    files: files.map((file) => join(root, file))
  };
}

function normalizeDomainPackId(id: string): string {
  const normalized = id.trim();

  if (!DOMAIN_PACK_ID_PATTERN.test(normalized)) {
    throw new Error(
      "Domain pack id must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens"
    );
  }

  return normalized;
}

async function writeIfMissing(
  path: string,
  contents: string,
  force = false
): Promise<void> {
  if (!force && (await exists(path))) {
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  }

  await writeFile(path, contents, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function authoringGuide(input: { id: string; name: string }): string {
  return `# ${input.name} Domain Pack Authoring

This pack is a governed business workflow contract. Do not treat it as a prompt
folder. Before adding worker guidance, define the domain surface in this order:

1. Business resources: update \`scope.resource_types\` with the durable objects
   this pack manages.
2. Workflows: model user-facing scenarios in \`goal-templates/*.yaml\`.
3. Task contracts: add one \`task-types/*.yaml\` file per recurring unit of
   work, including verifier requirements and worker routing.
4. Capability policy: update \`capability_policy\` and \`policies/*.yaml\` so
   reads, writes, denied surfaces, and approvals match the domain.
5. Evidence contract: declare workflow outputs and completion criteria in
   \`evidence_contracts\`.
6. Evidence evaluators: add \`evidence_requirement_evaluators\` for every output
   and criterion, using evidence types, task status, or event types that prove
   completion.
7. Fixtures and evals: add local fixtures and benchmark rows that exercise the
   contract without relying on live provider credentials.

Validation gates:

\`\`\`sh
runstead domain validate ${input.id}
runstead domain maturity ${input.id}
runstead run ${input.id} default-goal --plan
\`\`\`
`;
}

function domainYaml(input: { id: string; name: string; description: string }): string {
  return `id: ${input.id}
version: 0.1.0
name: ${yamlString(input.name)}
description: ${yamlString(input.description)}

compatibility:
  runstead_min_version: 0.0.0

scope:
  resource_types:
    - workspace_item

goal_templates:
  - default-goal

task_types:
  - manual_review

default_policy: policies/default.yaml

default_verifiers:
  - manual_review

required_tools:
  - filesystem

supported_workers:
  - shell

capability_policy:
  reads:
    - workspace_item
  writes:
    - runstead.evidence
  approvals_required:
    - external_write
  denied:
    - secret_read

evidence_contracts:
  - workflow: default-goal
    outputs:
      - manual_review
      - runstead.evidence
    completion_criteria:
      - manual_review_complete
      - evidence_attached

evidence_requirement_evaluators:
  - requirement: manual_review
    evidence_types:
      - manual_review
  - requirement: runstead.evidence
    evidence_types:
      - runstead.evidence
  - requirement: manual_review_complete
    task_types:
      - manual_review
    task_statuses:
      - blocked
      - completed
  - requirement: evidence_attached
    evidence_types:
      - manual_review
      - runstead.evidence

security:
  untrusted_inputs:
    - external_content
  protected_paths:
    - ".env"
    - ".env.*"
`;
}

function goalTemplateYaml(input: { id: string; name: string }): string {
  return `id: default-goal
domain: ${input.id}
title: ${yamlString(`Maintain ${input.name}`)}
description: >
  Track recurring ${input.name} work with explicit review evidence.

generated:
  recurring_tasks:
    - manual_review
  policy_profile: default
  acceptance_contracts:
    - manual_review_complete
`;
}

function taskTypeYaml(input: { id: string }): string {
  return `id: manual_review
domain: ${input.id}
description: Review the current domain state and attach evidence.

default_priority: medium
max_attempts: 1

verifiers:
  required:
    - manual_review:evidence_attached

worker_routing:
  preferred: shell
`;
}

function policyYaml(input: { id: string }): string {
  return `id: policy_${input.id.replaceAll("-", "_")}_default_v1
version: 1
default_decision: require_approval
default_risk: medium

rules:
  - id: require_review_before_external_write
    when:
      side_effects:
        contains_any:
          - network_write_external
          - send_message_external
    decision: require_approval
    risk: high

  - id: allow_local_evidence_collection
    when:
      action_type: evidence.collect
    decision: allow
    risk: low
    obligations:
      - attach_as_evidence
`;
}

function fixtureManifestYaml(): string {
  return `version: 1
fixtures:
  - id: manual-review-smoke
    description: Starter fixture for manual review evidence flow.
    path: manual-review-smoke
    task_type: manual_review
    goal_template: default-goal
    tags:
      - smoke
    acceptance_contracts:
      - manual_review_complete
`;
}

function fixtureReadme(input: { name: string }): string {
  return `# ${input.name} manual review smoke fixture

Use this fixture to capture representative inputs and expected evidence for the
starter manual review task.
`;
}

function evalBenchmarkYaml(): string {
  return `version: 1
benchmarks:
  - id: manual-review-smoke
    fixture: manual-review-smoke
    acceptance_contracts:
      - manual_review_complete
`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
