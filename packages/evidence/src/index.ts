import { z } from "zod";

export * from "./memory-tree.js";

export const EvidenceQualityTierSchema = z.enum([
  "none",
  "self_reported",
  "local_artifact",
  "machine_verified",
  "external_observed"
]);

export type EvidenceQualityTier = z.infer<typeof EvidenceQualityTierSchema>;

export const EvidenceSourceTrustSchema = z.enum([
  "low",
  "medium",
  "high",
  "authoritative"
]);

export type EvidenceSourceTrust = z.infer<typeof EvidenceSourceTrustSchema>;

export const EvidenceSourceSchema = z.object({
  kind: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  capturedAt: z.string().trim().min(1).optional(),
  freshnessDays: z.number().int().nonnegative().optional(),
  hash: z.string().trim().min(1).optional(),
  trust: EvidenceSourceTrustSchema.optional()
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export function defineEvidenceSource(input: EvidenceSource): EvidenceSource {
  return EvidenceSourceSchema.parse(input);
}

export function compareEvidenceQuality(
  left: EvidenceQualityTier,
  right: EvidenceQualityTier
): number {
  return evidenceTierRank(left) - evidenceTierRank(right);
}

export function evidenceTierRank(tier: EvidenceQualityTier): number {
  return EvidenceQualityTierSchema.options.indexOf(tier);
}
