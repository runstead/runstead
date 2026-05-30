import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DOMAIN_PACK_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const DomainPackCompatibilitySchema = z.object({
  runsteadMinVersion: z.string().regex(SEMVER_PATTERN),
  runsteadMaxVersion: z.string().regex(SEMVER_PATTERN).optional()
});

export const DomainPackScopeSchema = z.object({
  resourceTypes: z.array(z.string().min(1))
});

export const DomainPackSecuritySchema = z.object({
  untrustedInputs: z.array(z.string().min(1)),
  protectedPaths: z.array(z.string().min(1))
});

export const DomainPackCapabilityPolicySchema = z.object({
  reads: z.array(z.string().min(1)),
  writes: z.array(z.string().min(1)),
  approvalsRequired: z.array(z.string().min(1)),
  denied: z.array(z.string().min(1))
});

export const DomainPackEvidenceContractSchema = z.object({
  workflow: z.string().min(1),
  outputs: z.array(z.string().min(1)).min(1),
  completionCriteria: z.array(z.string().min(1)).min(1)
});

export const DomainPackEvidenceRequirementEvaluatorSchema = z.object({
  requirement: z.string().min(1),
  description: z.string().min(1).optional(),
  evidenceTypes: z.array(z.string().min(1)).default([]),
  taskTypes: z.array(z.string().min(1)).default([]),
  taskStatuses: z.array(z.string().min(1)).default([]),
  eventTypes: z.array(z.string().min(1)).default([]),
  match: z.enum(["any", "all"]).default("any")
});

export const DomainPackMigrationSchema = z.object({
  fromVersion: z.string().regex(SEMVER_PATTERN),
  toVersion: z.string().regex(SEMVER_PATTERN),
  description: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1)
});

export const DomainPackRepoTemplateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  requiredSignals: z.array(z.string().min(1)).min(1)
});

export const DomainPackGateThresholdSchema = z.object({
  maxCriticalBlockers: z.number().int().nonnegative().optional(),
  maxMajorBlockers: z.number().int().nonnegative().optional(),
  minimumEvidenceCompleteness: z.number().min(0).max(1).optional(),
  minimumReportQuality: z.number().min(0).max(1).optional()
});

export const DomainPackReportSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidenceTypes: z.array(z.string().min(1)).min(1)
});

export const DomainPackEvalQualitySchema = z.object({
  minimumScore: z.number().min(0).max(1),
  requiredContracts: z.array(z.string().min(1)).min(1)
});

export const DomainPackSchema = z.object({
  id: z.string().regex(DOMAIN_PACK_ID_PATTERN),
  schemaVersion: z.number().int().positive().optional(),
  version: z.string().regex(SEMVER_PATTERN),
  name: z.string().min(1),
  description: z.string().min(1),
  compatibility: DomainPackCompatibilitySchema,
  scope: DomainPackScopeSchema.optional(),
  goalTemplates: z.array(z.string().min(1)),
  taskTypes: z.array(z.string().min(1)),
  defaultPolicy: z.string().min(1),
  defaultVerifiers: z.array(z.string().min(1)),
  requiredTools: z.array(z.string().min(1)),
  supportedWorkers: z.array(z.string().min(1)),
  security: DomainPackSecuritySchema.optional(),
  capabilityPolicy: DomainPackCapabilityPolicySchema.optional(),
  evidenceContracts: z.array(DomainPackEvidenceContractSchema).optional(),
  evidenceRequirementEvaluators: z
    .array(DomainPackEvidenceRequirementEvaluatorSchema)
    .optional(),
  migrations: z.array(DomainPackMigrationSchema).optional(),
  repoTemplates: z.array(DomainPackRepoTemplateSchema).optional(),
  gateThresholds: z.record(z.string(), DomainPackGateThresholdSchema).optional(),
  reportSections: z.array(DomainPackReportSectionSchema).optional(),
  evalQuality: DomainPackEvalQualitySchema.optional()
});

export type DomainPack = z.infer<typeof DomainPackSchema>;

const DomainPackMigrationYamlSchema = z.object({
  from_version: z.string().regex(SEMVER_PATTERN),
  to_version: z.string().regex(SEMVER_PATTERN),
  description: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1)
});
const DomainPackRepoTemplateYamlSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  required_signals: z.array(z.string().min(1)).min(1)
});
const DomainPackGateThresholdYamlSchema = z.object({
  max_critical_blockers: z.number().int().nonnegative().optional(),
  max_major_blockers: z.number().int().nonnegative().optional(),
  minimum_evidence_completeness: z.number().min(0).max(1).optional(),
  minimum_report_quality: z.number().min(0).max(1).optional()
});
const DomainPackReportSectionYamlSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence_types: z.array(z.string().min(1)).min(1)
});
const DomainPackEvalQualityYamlSchema = z.object({
  minimum_score: z.number().min(0).max(1),
  required_contracts: z.array(z.string().min(1)).min(1)
});
const DomainPackCapabilityPolicyYamlSchema = z.object({
  reads: z.array(z.string().min(1)).default([]),
  writes: z.array(z.string().min(1)).default([]),
  approvals_required: z.array(z.string().min(1)).default([]),
  denied: z.array(z.string().min(1)).default([])
});
const DomainPackEvidenceContractYamlSchema = z.object({
  workflow: z.string().min(1),
  outputs: z.array(z.string().min(1)).min(1),
  completion_criteria: z.array(z.string().min(1)).min(1)
});
const DomainPackEvidenceRequirementEvaluatorYamlSchema = z.object({
  requirement: z.string().min(1),
  description: z.string().min(1).optional(),
  evidence_types: z.array(z.string().min(1)).default([]),
  task_types: z.array(z.string().min(1)).default([]),
  task_statuses: z.array(z.string().min(1)).default([]),
  event_types: z.array(z.string().min(1)).default([]),
  match: z.enum(["any", "all"]).default("any")
});

const DomainPackYamlSchema = z.object({
  id: z.string().regex(DOMAIN_PACK_ID_PATTERN),
  schema_version: z.number().int().positive().optional(),
  version: z.string().regex(SEMVER_PATTERN),
  name: z.string().min(1),
  description: z.string().min(1),
  compatibility: z.object({
    runstead_min_version: z.string().regex(SEMVER_PATTERN),
    runstead_max_version: z.string().regex(SEMVER_PATTERN).optional()
  }),
  scope: z
    .object({
      resource_types: z.array(z.string().min(1))
    })
    .optional(),
  goal_templates: z.array(z.string().min(1)),
  task_types: z.array(z.string().min(1)),
  default_policy: z.string().min(1),
  default_verifiers: z.array(z.string().min(1)),
  required_tools: z.array(z.string().min(1)),
  supported_workers: z.array(z.string().min(1)),
  security: z
    .object({
      untrusted_inputs: z.array(z.string().min(1)),
      protected_paths: z.array(z.string().min(1))
    })
    .optional(),
  capability_policy: DomainPackCapabilityPolicyYamlSchema.optional(),
  evidence_contracts: z.array(DomainPackEvidenceContractYamlSchema).optional(),
  evidence_requirement_evaluators: z
    .array(DomainPackEvidenceRequirementEvaluatorYamlSchema)
    .optional(),
  migrations: z.array(DomainPackMigrationYamlSchema).optional(),
  repo_templates: z.array(DomainPackRepoTemplateYamlSchema).optional(),
  gate_thresholds: z.record(z.string(), DomainPackGateThresholdYamlSchema).optional(),
  report_sections: z.array(DomainPackReportSectionYamlSchema).optional(),
  eval_quality: DomainPackEvalQualityYamlSchema.optional()
});

export function parseDomainPack(input: unknown): DomainPack {
  return DomainPackSchema.parse(input);
}

export function parseDomainPackYaml(input: unknown): DomainPack {
  const parsed = DomainPackYamlSchema.parse(input);

  return DomainPackSchema.parse({
    id: parsed.id,
    ...(parsed.schema_version === undefined
      ? {}
      : { schemaVersion: parsed.schema_version }),
    version: parsed.version,
    name: parsed.name,
    description: parsed.description,
    compatibility: {
      runsteadMinVersion: parsed.compatibility.runstead_min_version,
      ...(parsed.compatibility.runstead_max_version === undefined
        ? {}
        : { runsteadMaxVersion: parsed.compatibility.runstead_max_version })
    },
    scope:
      parsed.scope === undefined
        ? undefined
        : {
            resourceTypes: parsed.scope.resource_types
          },
    goalTemplates: parsed.goal_templates,
    taskTypes: parsed.task_types,
    defaultPolicy: parsed.default_policy,
    defaultVerifiers: parsed.default_verifiers,
    requiredTools: parsed.required_tools,
    supportedWorkers: parsed.supported_workers,
    security:
      parsed.security === undefined
        ? undefined
        : {
            untrustedInputs: parsed.security.untrusted_inputs,
            protectedPaths: parsed.security.protected_paths
          },
    ...(parsed.capability_policy === undefined
      ? {}
      : {
          capabilityPolicy: {
            reads: parsed.capability_policy.reads,
            writes: parsed.capability_policy.writes,
            approvalsRequired: parsed.capability_policy.approvals_required,
            denied: parsed.capability_policy.denied
          }
        }),
    ...(parsed.evidence_contracts === undefined
      ? {}
      : {
          evidenceContracts: parsed.evidence_contracts.map((contract) => ({
            workflow: contract.workflow,
            outputs: contract.outputs,
            completionCriteria: contract.completion_criteria
          }))
        }),
    ...(parsed.evidence_requirement_evaluators === undefined
      ? {}
      : {
          evidenceRequirementEvaluators: parsed.evidence_requirement_evaluators.map(
            (evaluator) => ({
              requirement: evaluator.requirement,
              ...(evaluator.description === undefined
                ? {}
                : { description: evaluator.description }),
              evidenceTypes: evaluator.evidence_types,
              taskTypes: evaluator.task_types,
              taskStatuses: evaluator.task_statuses,
              eventTypes: evaluator.event_types,
              match: evaluator.match
            })
          )
        }),
    ...(parsed.migrations === undefined
      ? {}
      : {
          migrations: parsed.migrations.map((migration) => ({
            fromVersion: migration.from_version,
            toVersion: migration.to_version,
            description: migration.description,
            steps: migration.steps
          }))
        }),
    ...(parsed.repo_templates === undefined
      ? {}
      : {
          repoTemplates: parsed.repo_templates.map((template) => ({
            id: template.id,
            label: template.label,
            description: template.description,
            requiredSignals: template.required_signals
          }))
        }),
    ...(parsed.gate_thresholds === undefined
      ? {}
      : {
          gateThresholds: Object.fromEntries(
            Object.entries(parsed.gate_thresholds).map(([stage, threshold]) => [
              stage,
              {
                ...(threshold.max_critical_blockers === undefined
                  ? {}
                  : { maxCriticalBlockers: threshold.max_critical_blockers }),
                ...(threshold.max_major_blockers === undefined
                  ? {}
                  : { maxMajorBlockers: threshold.max_major_blockers }),
                ...(threshold.minimum_evidence_completeness === undefined
                  ? {}
                  : {
                      minimumEvidenceCompleteness:
                        threshold.minimum_evidence_completeness
                    }),
                ...(threshold.minimum_report_quality === undefined
                  ? {}
                  : { minimumReportQuality: threshold.minimum_report_quality })
              }
            ])
          )
        }),
    ...(parsed.report_sections === undefined
      ? {}
      : {
          reportSections: parsed.report_sections.map((section) => ({
            id: section.id,
            title: section.title,
            description: section.description,
            evidenceTypes: section.evidence_types
          }))
        }),
    ...(parsed.eval_quality === undefined
      ? {}
      : {
          evalQuality: {
            minimumScore: parsed.eval_quality.minimum_score,
            requiredContracts: parsed.eval_quality.required_contracts
          }
        })
  });
}

export async function loadDomainPackFromFile(path: string): Promise<DomainPack> {
  const raw = await readFile(path, "utf8");
  return parseDomainPackYaml(parseYaml(raw));
}
