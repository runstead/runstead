import { z } from "zod";

import type { ReadinessEvidenceTier, ReadinessTarget } from "@runstead/runtime";

const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const RunsteadReadinessTargetSchema = z.enum(["local", "staging", "production"]);

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

export const RunsteadEvidenceQualityTierSchema = z.enum([
  "none",
  "self_reported",
  "local_artifact",
  "machine_verified",
  "external_observed"
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
  appliesToTargets: z
    .array(RunsteadReadinessTargetSchema)
    .default(["local", "staging", "production"]),
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
  safeForWrappedWorkers: z.boolean().default(false),
  qualityTier: RunsteadEvidenceQualityTierSchema.default("none"),
  defaultFreshnessDays: z.number().int().positive().optional()
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
    addDuplicateIdIssues(
      context,
      "facets",
      manifest.facets.map((facet) => facet.name)
    );
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
    addDuplicateIdIssues(
      context,
      "gates",
      manifest.gates.map((gate) => gate.id)
    );
  });

export type RunsteadReadinessTarget = ReadinessTarget;
export type RunsteadEvidenceTier = ReadinessEvidenceTier;
export type RunsteadEvidenceQualityTier = z.infer<
  typeof RunsteadEvidenceQualityTierSchema
>;
export type RunsteadFacetField = z.infer<typeof RunsteadFacetFieldSchema>;
export type RunsteadReadinessFacet = z.infer<typeof RunsteadReadinessFacetSchema>;
export type RunsteadEvidenceCollector = z.infer<typeof RunsteadEvidenceCollectorSchema>;
export type RunsteadVerifier = z.infer<typeof RunsteadVerifierSchema>;
export type RunsteadGate = z.infer<typeof RunsteadGateSchema>;
export type RunsteadExtensionManifest = z.infer<typeof RunsteadExtensionManifestSchema>;

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

export interface RunsteadCompiledVerifier {
  id: string;
  command: string;
  evidenceTier?: RunsteadEvidenceTier;
  producesEvidenceTypes: string[];
}

export interface RunsteadCompiledGate {
  id: string;
  stage: string;
  target: RunsteadReadinessTarget;
  requiredFacets: RunsteadReadinessFacet[];
  requiredEvidenceTiers: RunsteadEvidenceTier[];
  requiredEvidenceTypes: string[];
}

export interface RunsteadCompiledEvidenceRequirement {
  source: "facet" | "gate" | "verifier";
  sourceId: string;
  targets: RunsteadReadinessTarget[];
  evidenceTiers: RunsteadEvidenceTier[];
  evidenceTypes: string[];
  blockers: string[];
}

export interface RunsteadExtensionRuntimeContract {
  schemaVersion: 1;
  extensionId: string;
  extensionVersion: string;
  name: string;
  domains: string[];
  readinessTargets: RunsteadReadinessTarget[];
  facets: RunsteadReadinessFacet[];
  collectors: RunsteadEvidenceCollector[];
  verifiers: RunsteadCompiledVerifier[];
  gates: RunsteadCompiledGate[];
  requiredSecrets: string[];
  requiredEvidenceTiers: RunsteadEvidenceTier[];
  requiredEvidenceTypes: string[];
  evidenceRequirements: RunsteadCompiledEvidenceRequirement[];
  safeForWrappedWorkers: boolean;
}

export class RunsteadExtensionCompileError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Runstead extension compile failed: ${issues.join("; ")}`);
    this.name = "RunsteadExtensionCompileError";
    this.issues = issues;
  }
}

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

export function compileRunsteadExtensionRuntime(
  manifestInput: z.input<typeof RunsteadExtensionManifestSchema>
): RunsteadExtensionRuntimeContract {
  const manifest = defineRunsteadExtension(manifestInput);
  const compileIssues = runsteadExtensionCompileIssues(manifest);

  if (compileIssues.length > 0) {
    throw new RunsteadExtensionCompileError(compileIssues);
  }

  const facetsByName = new Map(
    manifest.facets.map((facet) => [facet.name, facet] as const)
  );
  const verifiers = manifest.verifiers.map((verifier) => ({
    id: verifier.id,
    command: verifier.command,
    ...(verifier.evidenceTier === undefined
      ? {}
      : { evidenceTier: verifier.evidenceTier }),
    producesEvidenceTypes: [...verifier.producesEvidenceTypes]
  }));
  const gates = manifest.gates.map((gate) => ({
    id: gate.id,
    stage: gate.stage,
    target: gate.target,
    requiredFacets: gate.requiredFacets.map((facetName) => {
      const facet = facetsByName.get(facetName);

      if (facet === undefined) {
        throw new RunsteadExtensionCompileError([
          `Gate ${gate.id} references unknown facet: ${facetName}`
        ]);
      }

      return facet;
    }),
    requiredEvidenceTiers: [...gate.requiredEvidenceTiers],
    requiredEvidenceTypes: [...gate.requiredEvidenceTypes]
  }));
  const evidenceRequirements = [
    ...manifest.facets.map(
      (facet): RunsteadCompiledEvidenceRequirement => ({
        source: "facet",
        sourceId: facet.name,
        targets: [...facet.appliesToTargets],
        evidenceTiers: [...facet.requiredEvidenceTiers],
        evidenceTypes: [...facet.requiredEvidenceTypes],
        blockers: [...facet.blockers]
      })
    ),
    ...gates.map(
      (gate): RunsteadCompiledEvidenceRequirement => ({
        source: "gate",
        sourceId: gate.id,
        targets: [gate.target],
        evidenceTiers: [...gate.requiredEvidenceTiers],
        evidenceTypes: [...gate.requiredEvidenceTypes],
        blockers: []
      })
    ),
    ...verifiers.map(
      (verifier): RunsteadCompiledEvidenceRequirement => ({
        source: "verifier",
        sourceId: verifier.id,
        targets: ["local", "staging", "production"],
        evidenceTiers:
          verifier.evidenceTier === undefined ? [] : [verifier.evidenceTier],
        evidenceTypes: [...verifier.producesEvidenceTypes],
        blockers: []
      })
    )
  ];

  return {
    schemaVersion: 1,
    extensionId: manifest.id,
    extensionVersion: manifest.version,
    name: manifest.name,
    domains: [...manifest.domains],
    readinessTargets: extensionReadinessTargets(manifest),
    facets: manifest.facets.map(copyReadinessFacet),
    collectors: manifest.collectors.map(copyEvidenceCollector),
    verifiers,
    gates,
    requiredSecrets: uniqueStrings(
      manifest.collectors.flatMap((collector) => collector.requiredSecrets)
    ),
    requiredEvidenceTiers: uniqueStrings(
      evidenceRequirements.flatMap((requirement) => requirement.evidenceTiers)
    ) as RunsteadEvidenceTier[],
    requiredEvidenceTypes: uniqueStrings(
      evidenceRequirements.flatMap((requirement) => requirement.evidenceTypes)
    ),
    evidenceRequirements,
    safeForWrappedWorkers: manifest.collectors.every(
      (collector) => collector.safeForWrappedWorkers
    )
  };
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

function runsteadExtensionCompileIssues(manifest: RunsteadExtensionManifest): string[] {
  const facetNames = new Set(manifest.facets.map((facet) => facet.name));

  return manifest.gates.flatMap((gate) =>
    gate.requiredFacets
      .filter((facetName) => !facetNames.has(facetName))
      .map((facetName) => `Gate ${gate.id} references unknown facet: ${facetName}`)
  );
}

function copyReadinessFacet(facet: RunsteadReadinessFacet): RunsteadReadinessFacet {
  return {
    ...facet,
    fields: facet.fields.map((field) => ({ ...field })),
    appliesToTargets: [...facet.appliesToTargets],
    requiredEvidenceTiers: [...facet.requiredEvidenceTiers],
    requiredEvidenceTypes: [...facet.requiredEvidenceTypes],
    blockers: [...facet.blockers]
  };
}

function copyEvidenceCollector(
  collector: RunsteadEvidenceCollector
): RunsteadEvidenceCollector {
  return {
    ...collector,
    producesEvidenceTypes: [...collector.producesEvidenceTypes],
    requiredSecrets: [...collector.requiredSecrets]
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
