import { z } from "zod";

import type { ReadinessEvidenceTier, ReadinessTarget } from "@runstead/runtime";

const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const RunsteadReadinessTargetSchema = z.enum([
  "local",
  "staging",
  "production"
]);

export const RunsteadEvidenceTierSchema = z.enum([
  "synthetic_smoke",
  "local_manual",
  "local_command",
  "ci_verified",
  "staging_deployment",
  "production_deployment",
  "real_user_analytics",
  "support_ticket",
  "security_scan"
]);

export const RunsteadFacetFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "string_array", "json"]),
  description: z.string().min(1).optional(),
  required: z.boolean().default(false)
});

export const RunsteadReadinessFacetSchema = z.object({
  name: z.string().regex(EXTENSION_ID_PATTERN),
  title: z.string().min(1),
  description: z.string().min(1),
  fields: z.array(RunsteadFacetFieldSchema).default([]),
  appliesToTargets: z.array(RunsteadReadinessTargetSchema).default([
    "local",
    "staging",
    "production"
  ]),
  requiredEvidenceTiers: z.array(RunsteadEvidenceTierSchema).default([]),
  requiredEvidenceTypes: z.array(z.string().min(1)).default([]),
  blockers: z.array(z.string().min(1)).default([])
});

export const RunsteadEvidenceCollectorSchema = z.object({
  id: z.string().regex(EXTENSION_ID_PATTERN),
  title: z.string().min(1),
  description: z.string().min(1),
  producesEvidenceTypes: z.array(z.string().min(1)).min(1),
  requiredSecrets: z.array(z.string().min(1)).default([]),
  safeForWrappedWorkers: z.boolean().default(false)
});

export const RunsteadVerifierSchema = z.object({
  id: z.string().regex(EXTENSION_ID_PATTERN),
  command: z.string().min(1),
  description: z.string().min(1).optional(),
  evidenceTier: RunsteadEvidenceTierSchema.optional(),
  producesEvidenceTypes: z.array(z.string().min(1)).default([])
});

export const RunsteadGateSchema = z.object({
  id: z.string().regex(EXTENSION_ID_PATTERN),
  stage: z.string().min(1),
  target: RunsteadReadinessTargetSchema,
  requiredFacets: z.array(z.string().min(1)).default([]),
  requiredEvidenceTiers: z.array(RunsteadEvidenceTierSchema).default([]),
  requiredEvidenceTypes: z.array(z.string().min(1)).default([])
});

export const RunsteadExtensionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(EXTENSION_ID_PATTERN),
    version: z.string().regex(SEMVER_PATTERN),
    name: z.string().min(1),
    description: z.string().min(1),
    domains: z.array(z.string().regex(EXTENSION_ID_PATTERN)).min(1),
    facets: z.array(RunsteadReadinessFacetSchema).default([]),
    collectors: z.array(RunsteadEvidenceCollectorSchema).default([]),
    verifiers: z.array(RunsteadVerifierSchema).default([]),
    gates: z.array(RunsteadGateSchema).default([])
  })
  .superRefine((manifest, context) => {
    addDuplicateIdIssues(context, "facets", manifest.facets.map((facet) => facet.name));
    addDuplicateIdIssues(
      context,
      "collectors",
      manifest.collectors.map((collector) => collector.id)
    );
    addDuplicateIdIssues(
      context,
      "verifiers",
      manifest.verifiers.map((verifier) => verifier.id)
    );
    addDuplicateIdIssues(context, "gates", manifest.gates.map((gate) => gate.id));
  });

export type RunsteadReadinessTarget = ReadinessTarget;
export type RunsteadEvidenceTier = ReadinessEvidenceTier;
export type RunsteadFacetField = z.infer<typeof RunsteadFacetFieldSchema>;
export type RunsteadReadinessFacet = z.infer<typeof RunsteadReadinessFacetSchema>;
export type RunsteadEvidenceCollector = z.infer<
  typeof RunsteadEvidenceCollectorSchema
>;
export type RunsteadVerifier = z.infer<typeof RunsteadVerifierSchema>;
export type RunsteadGate = z.infer<typeof RunsteadGateSchema>;
export type RunsteadExtensionManifest = z.infer<
  typeof RunsteadExtensionManifestSchema
>;

export type RunsteadExtensionValidationResult =
  | {
      valid: true;
      issues: [];
      manifest: RunsteadExtensionManifest;
    }
  | {
      valid: false;
      issues: string[];
      manifest?: undefined;
    };

export function defineReadinessFacet(
  facet: z.input<typeof RunsteadReadinessFacetSchema>
): RunsteadReadinessFacet {
  return RunsteadReadinessFacetSchema.parse(facet);
}

export function defineRunsteadExtension(
  manifest: z.input<typeof RunsteadExtensionManifestSchema>
): RunsteadExtensionManifest {
  return RunsteadExtensionManifestSchema.parse(manifest);
}

export function validateRunsteadExtension(
  manifest: unknown
): RunsteadExtensionValidationResult {
  const result = RunsteadExtensionManifestSchema.safeParse(manifest);

  if (result.success) {
    return {
      valid: true,
      issues: [],
      manifest: result.data
    };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => {
      const path = issue.path.join(".");

      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    })
  };
}

export function extensionReadinessTargets(
  manifest: RunsteadExtensionManifest
): RunsteadReadinessTarget[] {
  return [
    ...new Set([
      ...manifest.facets.flatMap((facet) => facet.appliesToTargets),
      ...manifest.gates.map((gate) => gate.target)
    ])
  ];
}

function addDuplicateIdIssues(
  context: z.RefinementCtx,
  collection: string,
  ids: string[]
): void {
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      context.addIssue({
        code: "custom",
        path: [collection],
        message: `Duplicate ${collection} id: ${id}`
      });
      continue;
    }

    seen.add(id);
  }
}
