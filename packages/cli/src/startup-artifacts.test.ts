import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createProgram } from "./index.js";
import { initRunstead } from "./init.js";
import { generateLaunchReadinessReport } from "./launch-readiness-report.js";
import {
  formatStartupArtifactList,
  formatStartupArtifactShow,
  listStartupArtifacts,
  migrateStartupArtifact,
  showStartupArtifact
} from "./startup-artifacts.js";
import { generateMeasurementFramework } from "./startup-automation.js";

describe("startup artifacts", () => {
  it("lists, shows, migrates, and reports structured startup artifacts", async () => {
    const workspace = join(tmpdir(), `runstead-startup-artifacts-${process.pid}`);

    try {
      await rm(workspace, { force: true, recursive: true });
      await initRunstead({ cwd: workspace });
      await generateMeasurementFramework({
        cwd: workspace,
        activationMetric: "Founder reaches first governed launch check",
        now: new Date("2026-05-14T05:00:00.000Z")
      });

      const listed = await listStartupArtifacts({ cwd: workspace });
      const measurementArtifact = listed.artifacts.find(
        (item) => item.kind === "startup_measurement_framework"
      );

      expect(measurementArtifact).toBeDefined();
      expect(measurementArtifact?.sourceEvidenceIds).toHaveLength(1);
      expect(formatStartupArtifactList(listed)).toContain(
        "startup_measurement_framework"
      );

      const shown = await showStartupArtifact({
        cwd: workspace,
        ref: basename(measurementArtifact?.path ?? "")
      });

      expect(formatStartupArtifactShow(shown)).toContain(
        "Founder reaches first governed launch check"
      );
      expect(migrateStartupArtifact(legacyArtifact())).toMatchObject({
        schema: "runstead.startupArtifact",
        kind: "legacy_startup_context"
      });

      const cliList = await runCli("startup", "artifact", "list", "--cwd", workspace);
      const cliShow = await runCli(
        "startup",
        "artifact",
        "show",
        "startup_measurement_framework",
        "--cwd",
        workspace
      );
      const report = await generateLaunchReadinessReport({
        cwd: workspace,
        now: new Date("2026-05-14T05:10:00.000Z")
      });

      expect(cliList).toContain("Startup artifacts:");
      expect(cliShow).toContain("sourceEvidenceIds");
      expect(report.markdown).toContain("## Structured Startup Artifacts");
      expect(report.markdown).toContain("startup_measurement_framework");
      expect(structuredArtifactCount(report.event.payload)).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

async function runCli(...args: string[]): Promise<string> {
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...items: unknown[]) => {
    output.push(items.map(String).join(" "));
  });

  try {
    await createProgram({ entrypoint: "/usr/local/bin/runstead" }).parseAsync(args, {
      from: "user"
    });
  } finally {
    log.mockRestore();
  }

  return output.join("\n");
}

function legacyArtifact(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "legacy_startup_context",
    generatedAt: "2026-05-14T05:00:00.000Z",
    markdownPath: "AGENTS.md",
    data: {
      summary: "legacy artifact without schema field"
    }
  };
}

function structuredArtifactCount(payload: Record<string, unknown>): number {
  const summary = payload.summary;

  if (
    typeof summary === "object" &&
    summary !== null &&
    "structuredArtifacts" in summary &&
    typeof summary.structuredArtifacts === "number"
  ) {
    return summary.structuredArtifacts;
  }

  return 0;
}
