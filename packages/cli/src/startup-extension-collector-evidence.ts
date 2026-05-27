import type { JsonObject } from "@runstead/core";
import type { ReadinessTarget } from "@runstead/runtime";
import {
  validateRunsteadCollectorOutput,
  type RunsteadEvidenceCollector
} from "@runstead/sdk";

import {
  addStartupEvidence,
  type StartupEvidenceSourceInput,
  type StartupGateStage
} from "./startup-evidence.js";
import type { LoadedStartupReadinessExtension } from "./startup-extension-loader.js";

export async function recordExtensionCollectorEvidence(input: {
  cwd: string;
  target: ReadinessTarget;
  stage: StartupGateStage;
  extension: LoadedStartupReadinessExtension;
  collector: RunsteadEvidenceCollector;
  stdout: string;
  now?: Date;
}): Promise<string[]> {
  const items = parseCollectorEvidenceItems(input.stdout);
  const evidenceIds: string[] = [];

  for (const item of items) {
    const type = normalizeStartupExtensionEvidenceType(
      stringValue(item.type) ?? stringValue(item.evidenceType) ?? ""
    );
    const produced = new Set(
      input.collector.producesEvidenceTypes.map(normalizeStartupExtensionEvidenceType)
    );

    if (!produced.has(type)) {
      throw new Error(
        `collector produced ${type || "unknown"} but declares ${input.collector.producesEvidenceTypes.join(", ")}`
      );
    }

    const outputValidation = validateRunsteadCollectorOutput(input.collector, item);

    if (!outputValidation.valid) {
      throw new Error(
        `collector output failed outputSchema validation: ${outputValidation.issues.join("; ")}`
      );
    }

    const content = collectorEvidenceContent({
      item,
      target: input.target,
      extensionId: input.extension.contract.extensionId,
      collector: input.collector
    });
    const result = await addStartupEvidence({
      cwd: input.cwd,
      type,
      summary:
        stringValue(item.summary) ??
        `Extension ${input.extension.contract.extensionId}/${input.collector.id} evidence`,
      content: JSON.stringify(content),
      sourceRefs: [
        `extension:${input.extension.contract.extensionId}/${input.collector.id}`
      ],
      sources: collectorEvidenceSources({
        item,
        extensionId: input.extension.contract.extensionId,
        collector: input.collector,
        ...(input.now === undefined ? {} : { now: input.now })
      }),
      gate: input.stage,
      ...(input.now === undefined ? {} : { now: input.now })
    });

    evidenceIds.push(result.evidence.id);
  }

  if (evidenceIds.length === 0) {
    throw new Error("collector stdout did not contain evidence records");
  }

  return evidenceIds;
}

export function normalizeStartupExtensionEvidenceType(type: string): string {
  return type.startsWith("startup_") ? type.slice("startup_".length) : type;
}

function parseCollectorEvidenceItems(stdout: string): Record<string, unknown>[] {
  const jsonText =
    stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("{") || line.startsWith("[")) ?? stdout.trim();
  const parsed = JSON.parse(jsonText) as unknown;
  const items =
    isRecord(parsed) && Array.isArray(parsed.evidence) ? parsed.evidence : [parsed];

  return items.filter(isRecord);
}

function collectorEvidenceContent(input: {
  item: Record<string, unknown>;
  target: ReadinessTarget;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
}): JsonObject {
  const rawContent = input.item.content;
  const content = isRecord(rawContent) ? rawContent : input.item;

  return {
    ...content,
    runsteadExtension: {
      extensionId: input.extensionId,
      collectorId: input.collector.id,
      target: input.target,
      qualityTier: input.collector.qualityTier,
      evidenceTier:
        input.collector.qualityTier === "external_observed"
          ? "real_user_analytics"
          : "local_command"
    }
  };
}

function collectorEvidenceSources(input: {
  item: Record<string, unknown>;
  extensionId: string;
  collector: RunsteadEvidenceCollector;
  now?: Date;
}): StartupEvidenceSourceInput[] {
  const validSources: StartupEvidenceSourceInput[] = [];

  if (Array.isArray(input.item.sources)) {
    for (const source of input.item.sources.filter(isRecord)) {
      const uri = stringValue(source.uri);

      if (uri === undefined) {
        continue;
      }

      const kind = stringValue(source.kind);
      const capturedAt = stringValue(source.capturedAt);
      const trustLevel = stringValue(source.trustLevel);

      validSources.push({
        uri,
        ...(kind === undefined ? {} : { kind }),
        ...(capturedAt === undefined ? {} : { capturedAt }),
        ...(typeof source.freshnessDays === "number"
          ? { freshnessDays: source.freshnessDays }
          : {}),
        ...(trustLevel === undefined ? {} : { trustLevel })
      });
    }
  }

  return [
    ...validSources,
    {
      kind:
        input.collector.qualityTier === "external_observed"
          ? "analytics_real_user"
          : "local_command",
      uri: `extension:${input.extensionId}/${input.collector.id}`,
      capturedAt: (input.now ?? new Date()).toISOString(),
      ...(input.collector.defaultFreshnessDays === undefined
        ? {}
        : { freshnessDays: input.collector.defaultFreshnessDays }),
      trustLevel: trustLevelForCollector(input.collector.qualityTier),
      provenance: {
        command: input.collector.command ?? "",
        adapterId: input.collector.adapterId ?? ""
      }
    }
  ];
}

function trustLevelForCollector(qualityTier: string): string {
  if (qualityTier === "external_observed") {
    return "authoritative";
  }

  if (qualityTier === "machine_verified") {
    return "high";
  }

  if (qualityTier === "local_artifact") {
    return "medium";
  }

  return "low";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
