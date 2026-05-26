import type {
  StartupArtifactListResult,
  StartupArtifactShowResult
} from "./startup-artifacts.js";

export function formatStartupArtifactList(result: StartupArtifactListResult): string {
  return [
    "Startup artifacts:",
    listOrNone(
      result.artifacts,
      (item) =>
        `- ${item.id} kind=${item.kind} schemaVersion=${item.schemaVersion} evidence=${item.sourceEvidenceIds.length}`
    )
  ].join("\n");
}

export function formatStartupArtifactShow(result: StartupArtifactShowResult): string {
  return `${JSON.stringify(
    {
      id: result.artifact.id,
      path: result.artifact.path,
      kind: result.artifact.kind,
      generatedAt: result.artifact.generatedAt,
      schemaVersion: result.artifact.schemaVersion,
      sourceEvidenceIds: result.artifact.sourceEvidenceIds,
      artifact: result.artifact.artifact
    },
    null,
    2
  )}\n`;
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
}
