import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  StartupArtifactHygieneFile,
  StartupArtifactHygieneResult
} from "./startup-artifact-hygiene.js";

export function formatStartupArtifactHygiene(
  result: StartupArtifactHygieneResult
): string {
  return [
    "Startup artifact hygiene",
    `Root: ${result.root}`,
    `Retention: ${result.retentionDays} days`,
    `Mode: ${result.pruned ? "prune" : "report-only"}`,
    `Files: ${result.summary.totalFiles}`,
    `Current: ${result.summary.currentFiles}`,
    `Referenced: ${result.summary.referencedFiles}`,
    `Superseded: ${result.summary.supersededFiles}`,
    `Unreferenced: ${result.summary.unreferencedFiles}`,
    `Prune candidates: ${result.summary.pruneCandidates}`,
    `Deleted: ${result.summary.deletedFiles}`,
    `Latest view: ${result.latestPath}`,
    `Report: ${result.reportPath}`,
    `JSON: ${result.jsonPath}`
  ].join("\n");
}

export function startupArtifactHygieneSummary(
  files: StartupArtifactHygieneFile[],
  pruneCandidates: StartupArtifactHygieneFile[],
  deletedFiles: string[]
): StartupArtifactHygieneResult["summary"] {
  return {
    totalFiles: files.length,
    currentFiles: files.filter((file) => file.layer === "current").length,
    referencedFiles: files.filter((file) => file.layer === "referenced").length,
    supersededFiles: files.filter((file) => file.layer === "superseded").length,
    unreferencedFiles: files.filter((file) => file.layer === "unreferenced").length,
    pruneCandidates: pruneCandidates.length,
    deletedFiles: deletedFiles.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    candidateBytes: pruneCandidates.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

export async function writeStartupArtifactHygieneResult(
  result: StartupArtifactHygieneResult
): Promise<void> {
  await mkdir(join(result.root, "reports"), { recursive: true });
  await mkdir(join(result.root, "startup"), { recursive: true });
  await writeFile(
    result.jsonPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: result.generatedAt,
        retentionDays: result.retentionDays,
        pruned: result.pruned,
        summary: result.summary,
        latest: result.latest,
        files: result.files,
        pruneCandidates: result.pruneCandidates,
        deletedFiles: result.deletedFiles
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    result.latestPath,
    `${JSON.stringify(result.latest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(result.reportPath, startupArtifactHygieneMarkdown(result), "utf8");
}

function startupArtifactHygieneMarkdown(result: StartupArtifactHygieneResult): string {
  return [
    "# Startup Artifact Hygiene",
    "",
    `Generated: ${result.generatedAt}`,
    `Retention days: ${result.retentionDays}`,
    `Mode: ${result.pruned ? "prune" : "report-only"}`,
    "",
    "## Summary",
    "",
    `- total_files: ${result.summary.totalFiles}`,
    `- current_files: ${result.summary.currentFiles}`,
    `- referenced_files: ${result.summary.referencedFiles}`,
    `- superseded_files: ${result.summary.supersededFiles}`,
    `- unreferenced_files: ${result.summary.unreferencedFiles}`,
    `- prune_candidates: ${result.summary.pruneCandidates}`,
    `- deleted_files: ${result.summary.deletedFiles}`,
    "",
    "## Latest View",
    "",
    `- readiness_run: ${result.latest.readinessRun ?? "none"}`,
    ...Object.entries(result.latest.evidenceByType).map(
      ([type, id]) => `- ${type}: ${id}`
    ),
    "",
    "## Prune Candidates",
    "",
    result.pruneCandidates.length === 0
      ? "- none"
      : result.pruneCandidates
          .slice(0, 50)
          .map(
            (file) =>
              `- ${file.relativePath} age=${file.ageDays}d bytes=${file.sizeBytes}`
          )
          .join("\n")
  ].join("\n");
}
