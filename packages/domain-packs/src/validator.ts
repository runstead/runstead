import { constants } from "node:fs";
import { access, lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { DomainPack } from "./domain-pack.js";
import { loadDomainPackFromFile } from "./domain-pack.js";
import type { GoalTemplate } from "./goal-template.js";
import { loadGoalTemplateFromFile } from "./goal-template.js";
import type { TaskType } from "./task-type.js";
import { loadTaskTypeFromFile } from "./task-type.js";

export type DomainPackValidationSeverity = "error" | "warning";

export interface DomainPackFixture {
  id: string;
  description: string;
  taskType: string;
  path: string;
  goalTemplate?: string;
  tags: string[];
  acceptanceContracts: string[];
}

export interface DomainPackEval {
  id: string;
  fixture: string;
  acceptanceContracts: string[];
}

export interface DomainPackValidationIssue {
  severity: DomainPackValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface DomainPackValidationResult {
  root: string;
  valid: boolean;
  issues: DomainPackValidationIssue[];
  domain?: DomainPack;
  goalTemplates: GoalTemplate[];
  taskTypes: TaskType[];
  fixtures: DomainPackFixture[];
  evals: DomainPackEval[];
}

const FIXTURE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const DomainPackPolicyDecisionSchema = z.enum(["allow", "deny", "require_approval"]);
const DomainPackPolicyRiskSchema = z.enum(["low", "medium", "high", "critical"]);
const DomainPackPolicyRuleSchema = z
  .object({
    id: z.string().min(1),
    when: z.record(z.string(), z.unknown()).optional(),
    decision: DomainPackPolicyDecisionSchema,
    risk: DomainPackPolicyRiskSchema.optional(),
    obligations: z.array(z.string().min(1)).optional()
  })
  .passthrough();
const DomainPackPolicyYamlSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    default_decision: DomainPackPolicyDecisionSchema.optional(),
    default_risk: DomainPackPolicyRiskSchema.optional(),
    rules: z.array(DomainPackPolicyRuleSchema)
  })
  .passthrough();
type DomainPackPolicyYaml = z.infer<typeof DomainPackPolicyYamlSchema>;
const DomainPackFixtureYamlSchema = z
  .object({
    version: z.literal(1),
    fixtures: z.array(
      z
        .object({
          id: z.string().regex(FIXTURE_ID_PATTERN),
          description: z.string().min(1),
          path: z.string().min(1).optional(),
          task_type: z.string().min(1),
          goal_template: z.string().min(1).optional(),
          tags: z.array(z.string().min(1)).optional(),
          acceptance_contracts: z.array(z.string().min(1)).optional()
        })
        .passthrough()
    )
  })
  .passthrough();
const DomainPackEvalYamlSchema = z
  .object({
    version: z.literal(1),
    benchmarks: z.array(
      z
        .object({
          id: z.string().regex(FIXTURE_ID_PATTERN),
          fixture: z.string().regex(FIXTURE_ID_PATTERN),
          acceptance_contracts: z.array(z.string().min(1)).min(1)
        })
        .passthrough()
    )
  })
  .passthrough();

export async function validateDomainPackDir(
  root: string
): Promise<DomainPackValidationResult> {
  const resolvedRoot = resolve(root);
  const issues: DomainPackValidationIssue[] = [];
  const goalTemplates: GoalTemplate[] = [];
  const taskTypes: TaskType[] = [];
  let fixtures: DomainPackFixture[] = [];
  let evals: DomainPackEval[] = [];
  const domainPath = join(resolvedRoot, "domain.yaml");
  const domain = await loadDomain(resolvedRoot, domainPath, issues);

  if (domain !== undefined) {
    collectDuplicateReferences("goal_template", domain.goalTemplates, issues);
    collectDuplicateReferences("task_type", domain.taskTypes, issues);
    assertEvidenceContractsReferenceWorkflows({ domain, issues });
    assertEvidenceRequirementEvaluators({ domain, issues });

    for (const templateId of domain.goalTemplates) {
      const templatePath = referencePath({
        root: resolvedRoot,
        directory: "goal-templates",
        id: templateId,
        codePrefix: "goal_template",
        issues
      });

      if (templatePath === undefined) {
        continue;
      }

      const template = await loadGoalTemplate(templatePath, issues);

      if (template === undefined) {
        continue;
      }

      goalTemplates.push(template);
      assertReferencedDocument({
        kind: "goal template",
        expectedId: templateId,
        expectedDomain: domain.id,
        actualId: template.id,
        actualDomain: template.domain,
        path: templatePath,
        issues
      });
    }

    for (const taskTypeId of domain.taskTypes) {
      const taskTypePath = referencePath({
        root: resolvedRoot,
        directory: "task-types",
        id: taskTypeId,
        codePrefix: "task_type",
        issues
      });

      if (taskTypePath === undefined) {
        continue;
      }

      const taskType = await loadTaskType(taskTypePath, issues);

      if (taskType === undefined) {
        continue;
      }

      taskTypes.push(taskType);
      assertReferencedDocument({
        kind: "task type",
        expectedId: taskTypeId,
        expectedDomain: domain.id,
        actualId: taskType.id,
        actualDomain: taskType.domain,
        path: taskTypePath,
        issues
      });
      assertDeclaredWorkerRouting({
        taskType,
        supportedWorkers: domain.supportedWorkers,
        path: taskTypePath,
        issues
      });
    }

    assertGoalTemplateRecurringTasks({
      goalTemplates,
      taskTypeIds: domain.taskTypes,
      issues
    });

    await collectUnregisteredYamlDocuments({
      root: resolvedRoot,
      directory: "goal-templates",
      registeredIds: domain.goalTemplates,
      codePrefix: "goal_template",
      label: "goal template",
      issues
    });
    await collectUnregisteredYamlDocuments({
      root: resolvedRoot,
      directory: "task-types",
      registeredIds: domain.taskTypes,
      codePrefix: "task_type",
      label: "task type",
      issues
    });

    await assertDefaultPolicy({
      path: join(resolvedRoot, domain.defaultPolicy),
      root: resolvedRoot,
      referencedPath: domain.defaultPolicy,
      issues
    });

    fixtures = await collectFixtureManifest({
      root: resolvedRoot,
      goalTemplateIds: domain.goalTemplates,
      taskTypeIds: domain.taskTypes,
      issues
    });
    evals = await collectEvalBenchmark({
      root: resolvedRoot,
      fixtureIds: fixtures.map((fixture) => fixture.id),
      issues
    });
  }

  return {
    root: resolvedRoot,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    ...(domain === undefined ? {} : { domain }),
    goalTemplates,
    taskTypes,
    fixtures,
    evals
  };
}

export function formatDomainPackValidationResult(
  result: DomainPackValidationResult
): string {
  return [
    "Runstead domain pack validation",
    `Path: ${result.root}`,
    `Status: ${result.valid ? "valid" : "invalid"}`,
    ...(result.domain === undefined ? [] : [`Domain: ${result.domain.id}`]),
    `Goal templates: ${result.goalTemplates.length}`,
    `Task types: ${result.taskTypes.length}`,
    `Fixtures: ${result.fixtures.length}`,
    `Evals: ${result.evals.length}`,
    ...result.issues.map(
      (issue) =>
        `  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${
          issue.path === undefined ? "" : ` (${issue.path})`
        }`
    )
  ].join("\n");
}

async function loadDomain(
  root: string,
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<DomainPack | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "domain_yaml_missing",
      message: "Domain pack must include domain.yaml",
      path
    });
    return undefined;
  }

  if (await collectSymlinkIssue("domain_yaml", root, path, issues)) {
    return undefined;
  }

  try {
    return await loadDomainPackFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "domain_yaml_invalid",
      message: errorMessage(error),
      path: relativeToRoot(root, path)
    });
    return undefined;
  }
}

async function loadGoalTemplate(
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<GoalTemplate | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "goal_template_missing",
      message: `Goal template file is missing: ${path}`,
      path
    });
    return undefined;
  }

  if (await collectSymlinkIssue("goal_template", undefined, path, issues)) {
    return undefined;
  }

  try {
    return await loadGoalTemplateFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "goal_template_invalid",
      message: errorMessage(error),
      path
    });
    return undefined;
  }
}

async function loadTaskType(
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<TaskType | undefined> {
  if (!(await fileExists(path))) {
    issues.push({
      severity: "error",
      code: "task_type_missing",
      message: `Task type file is missing: ${path}`,
      path
    });
    return undefined;
  }

  if (await collectSymlinkIssue("task_type", undefined, path, issues)) {
    return undefined;
  }

  try {
    return await loadTaskTypeFromFile(path);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "task_type_invalid",
      message: errorMessage(error),
      path
    });
    return undefined;
  }
}

function referencePath(input: {
  root: string;
  directory: string;
  id: string;
  codePrefix: string;
  issues: DomainPackValidationIssue[];
}): string | undefined {
  if (input.id.includes("/") || input.id.includes("\\") || input.id.includes("..")) {
    input.issues.push({
      severity: "error",
      code: `${input.codePrefix}_unsafe_reference`,
      message: `Pack reference must be a local id, received: ${input.id}`
    });
    return undefined;
  }

  return join(input.root, input.directory, `${input.id}.yaml`);
}

async function assertDefaultPolicy(input: {
  path: string;
  root: string;
  referencedPath: string;
  issues: DomainPackValidationIssue[];
}): Promise<void> {
  const resolvedPath = resolve(input.path);

  if (!isWithinRoot(input.root, resolvedPath)) {
    input.issues.push({
      severity: "error",
      code: "path_escapes_pack",
      message: `Referenced path escapes the domain pack: ${resolvedPath}`,
      path: resolvedPath
    });
    return;
  }

  if (!(await fileExists(resolvedPath))) {
    input.issues.push({
      severity: "error",
      code: "default_policy_missing",
      message: `Default policy file is missing: ${input.referencedPath}`,
      path: resolvedPath
    });
    return;
  }

  if (
    await collectSymlinkIssue("default_policy", input.root, resolvedPath, input.issues)
  ) {
    return;
  }

  try {
    const policy = DomainPackPolicyYamlSchema.parse(
      parseYaml(await readFile(resolvedPath, "utf8"))
    );
    assertDefaultPolicyDefaults({
      policy,
      path: relativeToRoot(input.root, resolvedPath),
      issues: input.issues
    });
    collectDuplicatePolicyRuleIds({
      ruleIds: policy.rules.map((rule) => rule.id),
      path: relativeToRoot(input.root, resolvedPath),
      issues: input.issues
    });
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "default_policy_invalid",
      message: errorMessage(error),
      path: relativeToRoot(input.root, resolvedPath)
    });
  }
}

function assertDefaultPolicyDefaults(input: {
  policy: DomainPackPolicyYaml;
  path: string;
  issues: DomainPackValidationIssue[];
}): void {
  if (input.policy.default_decision === undefined) {
    input.issues.push({
      severity: "error",
      code: "default_policy_default_decision_missing",
      message: "Default policy must declare default_decision for policy-by-default",
      path: input.path
    });
  }

  if (input.policy.default_risk === undefined) {
    input.issues.push({
      severity: "error",
      code: "default_policy_default_risk_missing",
      message: "Default policy must declare default_risk for policy-by-default",
      path: input.path
    });
  }
}

function collectDuplicatePolicyRuleIds(input: {
  ruleIds: string[];
  path: string;
  issues: DomainPackValidationIssue[];
}): void {
  const seen = new Set<string>();

  for (const ruleId of input.ruleIds) {
    if (seen.has(ruleId)) {
      input.issues.push({
        severity: "error",
        code: "default_policy_rule_duplicate_id",
        message: `Duplicate default policy rule id: ${ruleId}`,
        path: input.path
      });
    }

    seen.add(ruleId);
  }
}

function assertReferencedDocument(input: {
  kind: string;
  expectedId: string;
  expectedDomain: string;
  actualId: string;
  actualDomain: string;
  path: string;
  issues: DomainPackValidationIssue[];
}): void {
  if (input.actualId !== input.expectedId) {
    input.issues.push({
      severity: "error",
      code: `${input.kind.replaceAll(" ", "_")}_id_mismatch`,
      message: `Referenced ${input.kind} ${input.expectedId} has id ${input.actualId}`,
      path: input.path
    });
  }

  if (input.actualDomain !== input.expectedDomain) {
    input.issues.push({
      severity: "error",
      code: `${input.kind.replaceAll(" ", "_")}_domain_mismatch`,
      message: `Referenced ${input.kind} ${input.expectedId} belongs to ${input.actualDomain}, expected ${input.expectedDomain}`,
      path: input.path
    });
  }
}

function collectDuplicateReferences(
  kind: string,
  references: string[],
  issues: DomainPackValidationIssue[]
): void {
  const seen = new Set<string>();

  for (const reference of references) {
    if (seen.has(reference)) {
      issues.push({
        severity: "error",
        code: `${kind}_duplicate_reference`,
        message: `Duplicate ${kind.replaceAll("_", " ")} reference: ${reference}`
      });
    }

    seen.add(reference);
  }
}

function assertEvidenceContractsReferenceWorkflows(input: {
  domain: DomainPack;
  issues: DomainPackValidationIssue[];
}): void {
  const workflows = new Set([
    ...input.domain.goalTemplates,
    ...input.domain.taskTypes
  ]);

  for (const contract of input.domain.evidenceContracts ?? []) {
    if (workflows.has(contract.workflow)) {
      continue;
    }

    input.issues.push({
      severity: "error",
      code: "evidence_contract_unknown_workflow",
      message: `Evidence contract references unknown workflow: ${contract.workflow}`,
      path: "domain.yaml"
    });
  }
}

function assertEvidenceRequirementEvaluators(input: {
  domain: DomainPack;
  issues: DomainPackValidationIssue[];
}): void {
  const requirements = new Set(
    (input.domain.evidenceContracts ?? []).flatMap((contract) => [
      ...contract.outputs,
      ...contract.completionCriteria
    ])
  );
  const evaluators = new Map(
    (input.domain.evidenceRequirementEvaluators ?? []).map((evaluator) => [
      evaluator.requirement,
      evaluator
    ])
  );

  for (const requirement of requirements) {
    if (evaluators.has(requirement)) {
      continue;
    }

    input.issues.push({
      severity: "warning",
      code: "evidence_contract_requirement_evaluator_missing",
      message: `Evidence contract requirement ${requirement} does not declare a domain-specific evaluator`,
      path: "domain.yaml"
    });
  }

  for (const evaluator of evaluators.values()) {
    if (!requirements.has(evaluator.requirement)) {
      input.issues.push({
        severity: "warning",
        code: "evidence_requirement_evaluator_unknown_requirement",
        message: `Evidence requirement evaluator references unknown contract requirement: ${evaluator.requirement}`,
        path: "domain.yaml"
      });
    }

    if (
      evaluator.evidenceTypes.length === 0 &&
      evaluator.taskTypes.length === 0 &&
      evaluator.eventTypes.length === 0
    ) {
      input.issues.push({
        severity: "warning",
        code: "evidence_requirement_evaluator_empty",
        message: `Evidence requirement evaluator ${evaluator.requirement} does not declare evidence, task, or event signals`,
        path: "domain.yaml"
      });
    }
  }
}

function assertDeclaredWorkerRouting(input: {
  taskType: TaskType;
  supportedWorkers: string[];
  path: string;
  issues: DomainPackValidationIssue[];
}): void {
  const supported = new Set(input.supportedWorkers);
  const routedWorkers = [
    input.taskType.workerRouting.preferred,
    ...(input.taskType.workerRouting.fallback ?? [])
  ];

  for (const worker of routedWorkers) {
    if (!supported.has(worker)) {
      input.issues.push({
        severity: "error",
        code: "task_type_worker_undeclared",
        message: `Task type ${input.taskType.id} routes to undeclared worker: ${worker}`,
        path: input.path
      });
    }
  }
}

function assertGoalTemplateRecurringTasks(input: {
  goalTemplates: GoalTemplate[];
  taskTypeIds: string[];
  issues: DomainPackValidationIssue[];
}): void {
  const declaredTaskTypes = new Set(input.taskTypeIds);

  for (const template of input.goalTemplates) {
    for (const taskTypeId of template.generated.recurringTasks) {
      if (!declaredTaskTypes.has(taskTypeId)) {
        input.issues.push({
          severity: "error",
          code: "goal_template_recurring_task_unknown",
          message: `Goal template ${template.id} references unknown recurring task type: ${taskTypeId}`
        });
      }
    }
  }
}

async function collectUnregisteredYamlDocuments(input: {
  root: string;
  directory: string;
  registeredIds: string[];
  codePrefix: string;
  label: string;
  issues: DomainPackValidationIssue[];
}): Promise<void> {
  const directoryPath = join(input.root, input.directory);
  const registered = new Set(input.registeredIds);

  let entries: string[];

  try {
    entries = await readdir(directoryPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) {
      continue;
    }

    const id = basename(entry, ".yaml");

    if (!registered.has(id)) {
      input.issues.push({
        severity: "warning",
        code: `${input.codePrefix}_unregistered_yaml`,
        message: `Unregistered ${input.label} yaml is not referenced from domain.yaml: ${id}`,
        path: join(directoryPath, entry)
      });
    }
  }
}

async function collectFixtureManifest(input: {
  root: string;
  goalTemplateIds: string[];
  taskTypeIds: string[];
  issues: DomainPackValidationIssue[];
}): Promise<DomainPackFixture[]> {
  const manifestPath = join(input.root, "fixtures", "manifest.yaml");

  if (!(await fileExists(manifestPath))) {
    return [];
  }

  if (
    await collectSymlinkIssue(
      "fixture_manifest",
      input.root,
      manifestPath,
      input.issues
    )
  ) {
    return [];
  }

  let parsed: z.infer<typeof DomainPackFixtureYamlSchema>;

  try {
    parsed = DomainPackFixtureYamlSchema.parse(
      parseYaml(await readFile(manifestPath, "utf8"))
    );
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "fixture_manifest_invalid",
      message: errorMessage(error),
      path: relativeToRoot(input.root, manifestPath)
    });
    return [];
  }

  const fixtures = parsed.fixtures.map((fixture) => ({
    id: fixture.id,
    description: fixture.description,
    taskType: fixture.task_type,
    path: fixture.path ?? fixture.id,
    ...(fixture.goal_template === undefined
      ? {}
      : { goalTemplate: fixture.goal_template }),
    tags: fixture.tags ?? [],
    acceptanceContracts: fixture.acceptance_contracts ?? []
  }));

  collectDuplicateFixtureIds({
    fixtures,
    path: manifestPath,
    root: input.root,
    issues: input.issues
  });
  await assertFixtureReferences({
    fixtures,
    root: input.root,
    goalTemplateIds: input.goalTemplateIds,
    taskTypeIds: input.taskTypeIds,
    issues: input.issues
  });
  await collectUnregisteredFixtureDirectories({
    root: input.root,
    fixtures,
    issues: input.issues
  });

  return fixtures;
}

async function collectEvalBenchmark(input: {
  root: string;
  fixtureIds: string[];
  issues: DomainPackValidationIssue[];
}): Promise<DomainPackEval[]> {
  const benchmarkPath = join(input.root, "evals", "benchmark.yaml");

  if (!(await fileExists(benchmarkPath))) {
    return [];
  }

  if (
    await collectSymlinkIssue("eval_benchmark", input.root, benchmarkPath, input.issues)
  ) {
    return [];
  }

  let parsed: z.infer<typeof DomainPackEvalYamlSchema>;

  try {
    parsed = DomainPackEvalYamlSchema.parse(
      parseYaml(await readFile(benchmarkPath, "utf8"))
    );
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "eval_benchmark_invalid",
      message: errorMessage(error),
      path: relativeToRoot(input.root, benchmarkPath)
    });
    return [];
  }

  const evals = parsed.benchmarks.map((benchmark) => ({
    id: benchmark.id,
    fixture: benchmark.fixture,
    acceptanceContracts: benchmark.acceptance_contracts
  }));

  collectDuplicateEvalIds({
    evals,
    path: benchmarkPath,
    root: input.root,
    issues: input.issues
  });
  assertEvalFixtureReferences({
    evals,
    fixtureIds: input.fixtureIds,
    path: benchmarkPath,
    root: input.root,
    issues: input.issues
  });

  return evals;
}

function collectDuplicateFixtureIds(input: {
  fixtures: DomainPackFixture[];
  path: string;
  root: string;
  issues: DomainPackValidationIssue[];
}): void {
  const seen = new Set<string>();

  for (const fixture of input.fixtures) {
    if (seen.has(fixture.id)) {
      input.issues.push({
        severity: "error",
        code: "fixture_duplicate_id",
        message: `Duplicate fixture id: ${fixture.id}`,
        path: relativeToRoot(input.root, input.path)
      });
    }

    seen.add(fixture.id);
  }
}

async function assertFixtureReferences(input: {
  fixtures: DomainPackFixture[];
  root: string;
  goalTemplateIds: string[];
  taskTypeIds: string[];
  issues: DomainPackValidationIssue[];
}): Promise<void> {
  const fixturesRoot = join(input.root, "fixtures");
  const knownGoalTemplates = new Set(input.goalTemplateIds);
  const knownTaskTypes = new Set(input.taskTypeIds);

  for (const fixture of input.fixtures) {
    if (!knownTaskTypes.has(fixture.taskType)) {
      input.issues.push({
        severity: "error",
        code: "fixture_task_type_unknown",
        message: `Fixture ${fixture.id} references unknown task type: ${fixture.taskType}`,
        path: "fixtures/manifest.yaml"
      });
    }

    if (
      fixture.goalTemplate !== undefined &&
      !knownGoalTemplates.has(fixture.goalTemplate)
    ) {
      input.issues.push({
        severity: "error",
        code: "fixture_goal_template_unknown",
        message: `Fixture ${fixture.id} references unknown goal template: ${fixture.goalTemplate}`,
        path: "fixtures/manifest.yaml"
      });
    }

    const fixturePath = resolve(fixturesRoot, fixture.path);

    if (!isWithinRoot(fixturesRoot, fixturePath)) {
      input.issues.push({
        severity: "error",
        code: "fixture_path_escapes_pack",
        message: `Fixture ${fixture.id} path escapes fixtures/: ${fixture.path}`,
        path: "fixtures/manifest.yaml"
      });
      continue;
    }

    if (!(await fileExists(fixturePath))) {
      input.issues.push({
        severity: "error",
        code: "fixture_path_missing",
        message: `Fixture ${fixture.id} path is missing: ${fixture.path}`,
        path: relativeToRoot(input.root, fixturePath)
      });
      continue;
    }

    await collectSymlinkIssue("fixture_path", input.root, fixturePath, input.issues);
  }
}

async function collectSymlinkIssue(
  codePrefix: string,
  root: string | undefined,
  path: string,
  issues: DomainPackValidationIssue[]
): Promise<boolean> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) {
      return false;
    }
  } catch {
    return false;
  }

  issues.push({
    severity: "error",
    code: `${codePrefix}_symlink`,
    message: `Domain pack path must not be a symlink: ${path}`,
    path: root === undefined ? path : relativeToRoot(root, path)
  });

  return true;
}

async function collectUnregisteredFixtureDirectories(input: {
  root: string;
  fixtures: DomainPackFixture[];
  issues: DomainPackValidationIssue[];
}): Promise<void> {
  const fixturesRoot = join(input.root, "fixtures");
  const registeredTopLevel = new Set(
    input.fixtures.map((fixture) => fixture.path.split(/[\\/]/)[0] ?? fixture.path)
  );

  let directoryNames: string[];

  try {
    const entries = await readdir(fixturesRoot, { withFileTypes: true });
    directoryNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => String(entry.name));
  } catch {
    return;
  }

  for (const directoryName of directoryNames) {
    if (registeredTopLevel.has(directoryName)) {
      continue;
    }

    input.issues.push({
      severity: "warning",
      code: "fixture_unregistered_directory",
      message: `Unregistered fixture directory is not referenced from fixtures/manifest.yaml: ${directoryName}`,
      path: join(fixturesRoot, directoryName)
    });
  }
}

function collectDuplicateEvalIds(input: {
  evals: DomainPackEval[];
  path: string;
  root: string;
  issues: DomainPackValidationIssue[];
}): void {
  const seen = new Set<string>();

  for (const evaluation of input.evals) {
    if (seen.has(evaluation.id)) {
      input.issues.push({
        severity: "error",
        code: "eval_duplicate_id",
        message: `Duplicate eval id: ${evaluation.id}`,
        path: relativeToRoot(input.root, input.path)
      });
    }

    seen.add(evaluation.id);
  }
}

function assertEvalFixtureReferences(input: {
  evals: DomainPackEval[];
  fixtureIds: string[];
  path: string;
  root: string;
  issues: DomainPackValidationIssue[];
}): void {
  const knownFixtures = new Set(input.fixtureIds);

  for (const evaluation of input.evals) {
    if (!knownFixtures.has(evaluation.fixture)) {
      input.issues.push({
        severity: "error",
        code: "eval_fixture_unknown",
        message: `Eval ${evaluation.id} references unknown fixture: ${evaluation.fixture}`,
        path: relativeToRoot(input.root, input.path)
      });
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isWithinRoot(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);

  return (
    resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function relativeToRoot(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);

  return isWithinRoot(resolvedRoot, resolvedPath)
    ? resolvedPath.slice(resolvedRoot.length + 1)
    : resolvedPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
