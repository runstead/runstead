import type { JsonObject } from "@runstead/core";
import type { ReadinessTarget } from "@runstead/runtime";
import type { RunsteadEvidenceCollector } from "@runstead/sdk";

import type { StartupEvidenceSourceInput } from "./startup-evidence.js";

export function normalizeStartupExtensionEvidenceType(type: string): string {
  return type.startsWith("startup_") ? type.slice("startup_".length) : type;
}

export function parseCollectorEvidenceItems(stdout: string): Record<string, unknown>[] {
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

export function collectorEvidenceContent(input: {
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

export function collectorEvidenceSources(input: {
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

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
