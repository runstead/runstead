import { z } from "zod";

export const STARTUP_STRUCTURED_ARTIFACT_SCHEMA = "runstead.startupArtifact";
export const STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION = 1;

export const StartupStructuredArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  schema: z.literal(STARTUP_STRUCTURED_ARTIFACT_SCHEMA),
  kind: z.string().min(1),
  generatedAt: z.string().min(1),
  markdownPath: z.string().min(1),
  data: z.record(z.string(), z.unknown())
});

export type StartupStructuredArtifact = z.infer<typeof StartupStructuredArtifactSchema>;

export interface WriteStartupStructuredArtifactOptions {
  kind: string;
  generatedAt: string;
  markdownPath: string;
  structuredPath?: string;
  data: Record<string, unknown>;
}

export function migrateStartupArtifact(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (
    value.schema === undefined &&
    value.schemaVersion === STARTUP_STRUCTURED_ARTIFACT_SCHEMA_VERSION &&
    typeof value.kind === "string" &&
    typeof value.generatedAt === "string" &&
    typeof value.markdownPath === "string" &&
    isRecord(value.data)
  ) {
    return {
      ...value,
      schema: STARTUP_STRUCTURED_ARTIFACT_SCHEMA
    };
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
