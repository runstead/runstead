import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  formatMeasurementFramework,
  measurementMetricDefinitions
} from "./startup-automation-format.js";
import type {
  GenerateMeasurementFrameworkOptions,
  GenerateMeasurementFrameworkResult
} from "./startup-automation-types.js";
import {
  stableStartupGeneratedAt,
  writeStartupStructuredArtifact,
  writeTextFileIfChanged
} from "./startup-artifacts.js";
import { addStartupEvidence } from "./startup-evidence.js";
import { exists } from "./startup-workspace-hygiene.js";

export async function generateMeasurementFramework(
  options: GenerateMeasurementFrameworkOptions = {}
): Promise<GenerateMeasurementFrameworkResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const rootPath = join(cwd, "MEASUREMENT.md");
  const rootPathExists = await exists(rootPath);

  await mkdir(join(state.root, "startup"), { recursive: true });

  const runtimePath = join(state.root, "startup", "measurement-framework.md");
  const measurementData = {
    activationMetric:
      options.activationMetric ?? "User completes the first successful core workflow.",
    retentionMetric:
      options.retentionMetric ?? "User returns and completes a core workflow again.",
    day7Metric: options.day7Metric ?? "Day 7 retained active users by signup cohort.",
    day30Metric:
      options.day30Metric ?? "Day 30 retained active users by signup cohort.",
    falsePositiveMetric:
      options.falsePositiveMetric ??
      "Runstead or product claim is counted as success without user-confirmed value.",
    metrics: measurementMetricDefinitions({
      ...(options.activationMetric === undefined
        ? {}
        : { activationMetric: options.activationMetric }),
      ...(options.retentionMetric === undefined
        ? {}
        : { retentionMetric: options.retentionMetric }),
      ...(options.day7Metric === undefined ? {} : { day7Metric: options.day7Metric }),
      ...(options.day30Metric === undefined
        ? {}
        : { day30Metric: options.day30Metric }),
      ...(options.falsePositiveMetric === undefined
        ? {}
        : { falsePositiveMetric: options.falsePositiveMetric })
    })
  };
  const measurementGeneratedAt = await stableStartupGeneratedAt({
    kind: "startup_measurement_framework",
    markdownPath: runtimePath,
    data: {
      ...measurementData,
      ingested: rootPathExists && options.force !== true
    },
    fallback: generatedAt
  });
  const generatedFramework = formatMeasurementFramework({
    generatedAt: measurementGeneratedAt,
    ...(options.activationMetric === undefined
      ? {}
      : { activationMetric: options.activationMetric }),
    ...(options.retentionMetric === undefined
      ? {}
      : { retentionMetric: options.retentionMetric }),
    ...(options.day7Metric === undefined ? {} : { day7Metric: options.day7Metric }),
    ...(options.day30Metric === undefined ? {} : { day30Metric: options.day30Metric }),
    ...(options.falsePositiveMetric === undefined
      ? {}
      : { falsePositiveMetric: options.falsePositiveMetric })
  });
  const framework =
    rootPathExists && options.force !== true
      ? await readFile(rootPath, "utf8")
      : generatedFramework;

  if (!rootPathExists || options.force === true) {
    await writeTextFileIfChanged(rootPath, framework);
  }

  await writeTextFileIfChanged(runtimePath, framework);
  const structuredFiles = await Promise.all(
    [
      {
        markdownPath: rootPath,
        ...(options.writeTrackedContext === true
          ? {}
          : {
              structuredPath: join(
                state.root,
                "startup",
                "tracked-context",
                "MEASUREMENT.json"
              )
            })
      },
      { markdownPath: runtimePath }
    ].map((path) =>
      writeStartupStructuredArtifact({
        kind: "startup_measurement_framework",
        generatedAt: measurementGeneratedAt,
        markdownPath: path.markdownPath,
        ...(path.structuredPath === undefined
          ? {}
          : { structuredPath: path.structuredPath }),
        data: {
          ...measurementData,
          ingested: rootPathExists && options.force !== true
        }
      })
    )
  );

  const evidence = await addStartupEvidence({
    cwd,
    type: "measurement_framework",
    summary:
      rootPathExists && options.force !== true
        ? "Ingested existing startup measurement framework"
        : "Generated startup measurement framework",
    sourceRefs: [rootPath, runtimePath, ...structuredFiles],
    content: framework,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return {
    root: state.root,
    stateDb: state.stateDb,
    files: [rootPath, runtimePath],
    structuredFiles,
    evidenceId: evidence.evidence.id
  };
}
